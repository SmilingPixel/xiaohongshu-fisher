import * as vscode from 'vscode';

const COMMAND_PREFIX = 'xiaohongshu-fisher.';
const HOME_URL = 'https://www.xiaohongshu.com/';

type ViewKey = 'homeFeed' | 'exploreFeed' | 'searchResults';

class StatusTreeItem extends vscode.TreeItem {
	constructor(label: string, description: string, command?: vscode.Command) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.contextValue = 'status';
		this.command = command;
	}
}

class StatusTreeProvider implements vscode.TreeDataProvider<StatusTreeItem>, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<StatusTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private status = '内容读取将在后续阶段接入';
	private detail = '当前不会发起平台请求';

	constructor(private readonly refreshCommand: string) {}

	getTreeItem(element: StatusTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): StatusTreeItem[] {
		return [new StatusTreeItem(this.status, this.detail, { command: this.refreshCommand, title: '刷新' })];
	}

	setStatus(status: string, detail: string): void {
		this.status = status;
		this.detail = detail;
		this.changeEmitter.fire(undefined);
	}

	refresh(): void {
		this.changeEmitter.fire(undefined);
	}

	dispose(): void {
		this.changeEmitter.dispose();
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
		const uri = vscode.Uri.parse(candidate);
		const hostname = uri.authority.toLowerCase().split(':')[0];
		if (uri.scheme !== 'https' || !(hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com'))) {
			return undefined;
		}
		return uri;
	} catch {
		return undefined;
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const providers: Record<ViewKey, StatusTreeProvider> = {
		homeFeed: new StatusTreeProvider(`${COMMAND_PREFIX}refreshHomeFeed`),
		exploreFeed: new StatusTreeProvider(`${COMMAND_PREFIX}refreshExploreFeed`),
		searchResults: new StatusTreeProvider(`${COMMAND_PREFIX}searchNotes`),
	};

	context.subscriptions.push(...Object.values(providers));
	context.subscriptions.push(
		vscode.window.createTreeView('xiaohongshuFisher.homeFeed', { treeDataProvider: providers.homeFeed }),
		vscode.window.createTreeView('xiaohongshuFisher.exploreFeed', { treeDataProvider: providers.exploreFeed }),
		vscode.window.createTreeView('xiaohongshuFisher.searchResults', { treeDataProvider: providers.searchResults })
	);

	registerCommand(context, 'refreshHomeFeed', () => {
		providers.homeFeed.refresh();
		void vscode.window.showInformationMessage('推荐内容源将在后续阶段接入。');
	});
	registerCommand(context, 'refreshExploreFeed', () => {
		providers.exploreFeed.refresh();
		void vscode.window.showInformationMessage('发现内容源将在后续阶段接入。');
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
		providers.searchResults.setStatus('搜索内容源尚未接入', `关键词：${query.trim()}`);
	});
	registerCommand(context, 'loadMore', () => {
		void vscode.window.showInformationMessage('分页读取将在内容源接入后可用。');
	});
	registerCommand(context, 'openNote', async (value: unknown) => {
		const uri = getTrustedNoteUrl(value);
		if (uri) {
			await vscode.env.openExternal(uri);
			return;
		}
		void vscode.window.showInformationMessage('笔记阅读器将在后续阶段接入。');
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
		await vscode.env.openExternal(vscode.Uri.parse(HOME_URL));
	});
	registerCommand(context, 'clearSession', () => {
		void vscode.window.showInformationMessage('当前尚未创建插件专属会话。');
	});
}
