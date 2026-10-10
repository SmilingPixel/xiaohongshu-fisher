import * as vscode from 'vscode';
import { ContentApplicationService, type FeedKey, type FeedState } from './application/content-service';
import type { FeedItem } from './models/content';
import { SourceError } from './models/source-error';
import { BrowserSession } from './session/browser-session';
import { normalizeBrowserMode } from './session/browser-mode';
import { LoginQrImageProvider } from './session/login-qr-image-provider';
import { XiaohongshuPageSource } from './sources/xiaohongshu-page-source';
import { LoginAssistant } from './webview/login-assistant';
import { NoteReader } from './webview/note-reader';
import { ExtensionLogger } from './logging';

const COMMAND_PREFIX = 'xiaohongshu-fisher.';
type ViewKey = 'homeFeed' | 'exploreFeed' | 'searchResults';

class StatusTreeItem extends vscode.TreeItem {
	constructor(label: string, description: string, command?: vscode.Command, contextValue = 'status') {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.contextValue = contextValue;
		this.command = command;
	}
}

class StatusTreeProvider implements vscode.TreeDataProvider<StatusTreeItem>, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<StatusTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private state: Readonly<FeedState> = { items: [], isLoading: false, isLoadingMore: false };

	constructor(private readonly refreshCommand: string) {}

	getTreeItem(element: StatusTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): StatusTreeItem[] {
		if (this.state.items.length > 0) {
			const items = this.state.items.map(item => this.toTreeItem(item));
			if (this.state.isLoadingMore) {items.push(new StatusTreeItem('正在加载下一页…', '', undefined));}
			if (this.state.nextCursor) {
				items.push(new StatusTreeItem('加载更多', '', { command: `${COMMAND_PREFIX}loadMore`, title: '加载更多' }, 'loadMore'));
			}
			return items;
		}
		if (this.state.isLoading) {return [new StatusTreeItem('正在加载…', '', undefined)];}
		if (this.state.error) {
			return [new StatusTreeItem(this.state.error.message, '重试以重新加载', { command: this.refreshCommand, title: '重试' })];
		}
		return [new StatusTreeItem('尚无内容', '选择刷新或搜索开始阅读', { command: this.refreshCommand, title: '刷新' })];
	}

	setState(state: Readonly<FeedState>): void {
		this.state = state;
		this.changeEmitter.fire(undefined);
	}

	refresh(): void {
		this.changeEmitter.fire(undefined);
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	private toTreeItem(item: FeedItem): StatusTreeItem {
		const metadata = [item.author?.name, item.mediaType === 'unknown' ? undefined : item.mediaType]
			.filter(Boolean)
			.join(' · ');
		const treeItem = new StatusTreeItem(item.title, metadata, {
			command: `${COMMAND_PREFIX}openNote`,
			title: '打开笔记',
			arguments: [item],
		}, 'note');
		treeItem.tooltip = item.excerpt ?? item.title;
		return treeItem;
	}
}

function registerCommand(
	context: vscode.ExtensionContext,
	command: string,
	handler: (...args: unknown[]) => unknown
): void {
	context.subscriptions.push(vscode.commands.registerCommand(`${COMMAND_PREFIX}${command}`, handler));
}

function getTrustedNoteUrl(value: unknown): vscode.Uri | undefined {
	const candidate = typeof value === 'string'
		? value
		: typeof value === 'object' && value !== null && 'noteUrl' in value
			? (value as { noteUrl?: unknown }).noteUrl
			: undefined;
	if (typeof candidate !== 'string') {
		return undefined;
	}

	try {
		const url = new URL(candidate);
		if (url.protocol !== 'https:' || url.username || url.password ||
			!(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'))) {
			return undefined;
		}
		return vscode.Uri.parse(url.toString());
	} catch {
		return undefined;
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const logger = new ExtensionLogger();
	const configuredMode = normalizeBrowserMode(
		vscode.workspace.getConfiguration('xiaohongshu-fisher').get<unknown>('browserMode')
	);
	const session = new BrowserSession(context.globalStorageUri, configuredMode, logger);
	const source = new XiaohongshuPageSource(session, logger);
	const application = new ContentApplicationService(source, logger);
	const loginQrImageProvider = new LoginQrImageProvider();
	const loginAssistant = new LoginAssistant(session, loginQrImageProvider, logger);
	const reader = new NoteReader(application);
	const providers: Record<ViewKey, StatusTreeProvider> = {
		homeFeed: new StatusTreeProvider(`${COMMAND_PREFIX}refreshHomeFeed`),
		exploreFeed: new StatusTreeProvider(`${COMMAND_PREFIX}refreshExploreFeed`),
		searchResults: new StatusTreeProvider(`${COMMAND_PREFIX}searchNotes`),
	};

	context.subscriptions.push(logger, session, loginQrImageProvider, loginAssistant, reader, { dispose: () => application.dispose() }, ...Object.values(providers));
	logger.info('Extension activated (browser mode: %s, remote: %s).', session.getMode(), Boolean(vscode.env.remoteName));
	context.subscriptions.push({ dispose: () => { void source.dispose(); } });
	context.subscriptions.push(
		vscode.window.createTreeView('xiaohongshuFisher.homeFeed', { treeDataProvider: providers.homeFeed }),
		vscode.window.createTreeView('xiaohongshuFisher.exploreFeed', { treeDataProvider: providers.exploreFeed }),
		vscode.window.createTreeView('xiaohongshuFisher.searchResults', { treeDataProvider: providers.searchResults })
	);
	context.subscriptions.push(application.subscribe((key, state) => {
		const viewKey: ViewKey = key === 'home' ? 'homeFeed' : key === 'explore' ? 'exploreFeed' : 'searchResults';
		providers[viewKey].setState(state);
	}));

	registerCommand(context, 'refreshHomeFeed', () => {
		return application.refreshHomeFeed();
	});
	registerCommand(context, 'refreshExploreFeed', () => {
		return application.refreshExploreFeed();
	});
	registerCommand(context, 'searchNotes', async () => {
		const query = await vscode.window.showInputBox({ prompt: '搜索小红书笔记', ignoreFocusOut: true });
		if (query === undefined) {
			return;
		}
		if (!query.trim()) {
			void vscode.window.showWarningMessage('请输入搜索关键词。');
			return;
		}
		return application.searchNotes(query);
	});
	registerCommand(context, 'loadMore', async (...args: unknown[]) => {
		const key = args[0] as FeedKey | undefined;
		const selectedView = key ?? await vscode.window.showQuickPick(
			[
				{ label: '推荐', key: 'home' as const },
				{ label: '发现', key: 'explore' as const },
				{ label: '搜索结果', key: 'search' as const },
			],
			{ placeHolder: '选择要继续加载的列表' }
		);
		if (typeof selectedView === 'string') {return application.loadMore(selectedView);}
		if (selectedView) {return application.loadMore(selectedView.key);}
	});
	registerCommand(context, 'openNote', async (value: unknown) => {
		if (typeof value === 'object' && value !== null && 'id' in value && 'title' in value && 'noteUrl' in value) {
			const candidate = value as Partial<FeedItem>;
			if (typeof candidate.id === 'string' && typeof candidate.title === 'string' &&
				typeof candidate.noteUrl === 'string' && candidate.noteUrl.length < 4096) {
				await reader.open(candidate as FeedItem);
				return;
			}
		}
		const uri = getTrustedNoteUrl(value);
		if (uri) {
			await vscode.env.openExternal(uri);
			return;
		}
		void vscode.window.showWarningMessage('没有可读取的小红书笔记。');
	});
	registerCommand(context, 'openInBrowser', async (value: unknown) => {
		const uri = getTrustedNoteUrl(value);
		if (uri) {
			await vscode.env.openExternal(uri);
			return;
		}
		void vscode.window.showWarningMessage('没有可打开的小红书笔记链接。');
	});
	registerCommand(context, 'openLogin', async () => {
		try {
			if (session.getMode() === 'headless') {
				await loginAssistant.open();
				return;
			}
			await source.openLogin();
		} catch (error) {
			const sourceError = error instanceof SourceError ? error : undefined;
			if (sourceError?.code === 'browser-missing' || sourceError?.code === 'browser-dependencies') {
				void vscode.window.showErrorMessage(sourceError.message, '安装 Playwright Chromium').then(selection => {
					if (selection) {void vscode.commands.executeCommand(`${COMMAND_PREFIX}installBrowserRuntime`);}
				});
				return;
			}
			void vscode.window.showErrorMessage(sourceError?.message ?? '无法打开独立的小红书浏览器。');
		}
	});
	registerCommand(context, 'refreshLoginQr', () => {
		if (session.getMode() !== 'headless') {
			void vscode.window.showInformationMessage('当前使用可见浏览器，无头登录二维码仅适用于 headless 模式。');
			return;
		}
		return loginAssistant.refreshQr();
	});
	registerCommand(context, 'installBrowserRuntime', () => {
		const terminal = vscode.window.createTerminal({
			name: 'Xiaohongshu Fisher: Install Browser',
			cwd: context.extensionUri.fsPath,
		});
		terminal.show();
		terminal.sendText(process.platform === 'linux'
			? 'pnpm exec playwright install --with-deps chromium'
			: 'pnpm exec playwright install chromium');
	});
	registerCommand(context, 'clearSession', async () => {
		const answer = await vscode.window.showWarningMessage(
			'清除小红书 Fisher 保存的独立浏览器会话？',
			{ modal: true },
			'清除会话'
		);
		if (answer === '清除会话') {
			await session.clear();
			void vscode.window.showInformationMessage('独立浏览器会话已清除。');
		}
	});
}
