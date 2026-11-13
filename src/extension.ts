import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ContentApplicationService, type FeedKey } from './application/content-service';
import type { FeedItem } from './models/content';
import { SourceError } from './models/source-error';
import { BrowserSession } from './session/browser-session';
import { LoginQrImageProvider } from './session/login-qr-image-provider';
import { XiaohongshuPageSource } from './sources/xiaohongshu-page-source';
import { LoginAssistant } from './webview/login-assistant';
import { NoteReader } from './webview/note-reader';
import { ExtensionLogger } from './logging';
import { StatusTreeProvider } from './views/status-tree-provider';

const COMMAND_PREFIX = 'xiaohongshu-fisher.';
type ViewKey = 'homeFeed' | 'exploreFeed' | 'searchResults';
const FEED_VIEWS: Record<FeedKey, ViewKey> = {
	home: 'homeFeed',
	explore: 'exploreFeed',
	search: 'searchResults',
};

function registerCommand(
	context: vscode.ExtensionContext,
	command: string,
	handler: (...args: unknown[]) => unknown,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(`${COMMAND_PREFIX}${command}`, handler),
	);
}

function getTrustedNoteUrl(
	value: unknown,
	resolveNoteUrl: (id: string) => string,
): vscode.Uri | undefined {
	let candidate: unknown = value;
	if (typeof value === 'object' && value !== null && 'noteUrl' in value) {
		candidate = value.noteUrl;
	}
	if (typeof candidate !== 'string') {
		return undefined;
	}

	try {
		const url = new URL(candidate);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.port ||
			!(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'))
		) {
			return undefined;
		}
		const noteId = /^\/explore\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
		if (noteId && !url.searchParams.get('xsec_token')) {
			return vscode.Uri.parse(resolveNoteUrl(noteId));
		}
		return vscode.Uri.parse(url.toString());
	} catch {
		return undefined;
	}
}

/** Wires services and views; browser startup remains deferred until a user command needs it. */
export function activate(context: vscode.ExtensionContext): void {
	if (vscode.l10n.bundle) {
		l10n.config({ contents: vscode.l10n.bundle });
	}
	const logger = new ExtensionLogger();
	const session = new BrowserSession(context.globalStorageUri, logger, () =>
		vscode.workspace
			.getConfiguration('xiaohongshu-fisher')
			.get<string>('browserMode', 'headless') === 'window'
			? 'window'
			: 'headless',
	);
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

	context.subscriptions.push(
		logger,
		session,
		loginQrImageProvider,
		loginAssistant,
		reader,
		{ dispose: () => application.dispose() },
		...Object.values(providers),
	);
	logger.info('Extension activated (remote: %s).', Boolean(vscode.env.remoteName));
	context.subscriptions.push({
		dispose: () => {
			void source.dispose();
		},
	});
	context.subscriptions.push(
		vscode.window.createTreeView('xiaohongshuFisher.homeFeed', {
			treeDataProvider: providers.homeFeed,
		}),
		vscode.window.createTreeView('xiaohongshuFisher.exploreFeed', {
			treeDataProvider: providers.exploreFeed,
		}),
		vscode.window.createTreeView('xiaohongshuFisher.searchResults', {
			treeDataProvider: providers.searchResults,
		}),
	);
	context.subscriptions.push(
		application.subscribe((key, state) => {
			providers[FEED_VIEWS[key]].setState(state);
		}),
	);

	registerCommand(context, 'refreshHomeFeed', () => {
		return application.refreshHomeFeed();
	});
	registerCommand(context, 'refreshExploreFeed', () => {
		return application.refreshExploreFeed();
	});
	registerCommand(context, 'searchNotes', async () => {
		const query = await vscode.window.showInputBox({
			prompt: vscode.l10n.t('Search Xiaohongshu notes'),
			ignoreFocusOut: true,
		});
		if (query === undefined) {
			return;
		}
		if (!query.trim()) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Enter a search keyword.'));
			return;
		}
		return application.searchNotes(query);
	});
	registerCommand(context, 'loadMore', async (...args: unknown[]) => {
		const key = args[0] as FeedKey | undefined;
		const selectedView =
			key ??
			(await vscode.window.showQuickPick(
				[
					{ label: vscode.l10n.t('Home'), key: 'home' as const },
					{ label: vscode.l10n.t('Explore'), key: 'explore' as const },
					{ label: vscode.l10n.t('Search Results'), key: 'search' as const },
				],
				{ placeHolder: vscode.l10n.t('Select a list to load more items') },
			));
		if (typeof selectedView === 'string') {
			return application.loadMore(selectedView);
		}
		if (selectedView) {
			return application.loadMore(selectedView.key);
		}
	});
	registerCommand(context, 'openNote', async (value: unknown) => {
		if (
			typeof value === 'object' &&
			value !== null &&
			'id' in value &&
			'title' in value &&
			'noteUrl' in value
		) {
			const candidate = value as Partial<FeedItem>;
			if (
				typeof candidate.id === 'string' &&
				typeof candidate.title === 'string' &&
				typeof candidate.noteUrl === 'string' &&
				candidate.noteUrl.length < 4096
			) {
				await reader.open(candidate as FeedItem);
				return;
			}
		}
		void vscode.window.showWarningMessage(
			vscode.l10n.t('No Xiaohongshu note is available to read.'),
		);
	});
	registerCommand(context, 'openInBrowser', async (value: unknown) => {
		const uri = getTrustedNoteUrl(value, (id) => application.getNoteUrl(id));
		if (uri) {
			await vscode.env.openExternal(uri);
			return;
		}
		void vscode.window.showWarningMessage(
			vscode.l10n.t('No Xiaohongshu note link is available to open.'),
		);
	});
	registerCommand(context, 'openLogin', async () => {
		try {
			await loginAssistant.open();
		} catch (error) {
			const sourceError = error instanceof SourceError ? error : undefined;
			if (sourceError?.code === 'browser-missing' || sourceError?.code === 'browser-dependencies') {
				void vscode.window
					.showErrorMessage(sourceError.message, vscode.l10n.t('Install Playwright Chromium'))
					.then((selection) => {
						if (selection) {
							void vscode.commands.executeCommand(`${COMMAND_PREFIX}installBrowserRuntime`);
						}
					});
				return;
			}
			void vscode.window.showErrorMessage(
				sourceError?.message ?? vscode.l10n.t('Unable to start login.'),
			);
		}
	});
	registerCommand(context, 'refreshLoginQr', () => {
		return loginAssistant.refreshQr();
	});
	registerCommand(context, 'installBrowserRuntime', () => {
		const terminal = vscode.window.createTerminal({
			name: vscode.l10n.t('Xiaohongshu Fisher: Install Browser'),
			cwd: context.extensionUri.fsPath,
		});
		terminal.show();
		terminal.sendText(
			process.platform === 'linux'
				? 'npm exec --no -- playwright install --with-deps chromium'
				: 'npm exec --no -- playwright install chromium',
		);
	});
	registerCommand(context, 'clearSession', async () => {
		const clearLabel = vscode.l10n.t('Clear Session');
		const answer = await vscode.window.showWarningMessage(
			vscode.l10n.t('Clear the browser session saved by Xiaohongshu Fisher?'),
			{ modal: true },
			clearLabel,
		);
		if (answer === clearLabel) {
			await session.clear();
			void vscode.window.showInformationMessage(
				vscode.l10n.t('The extension browser session has been cleared.'),
			);
		}
	});
}
