import * as vscode from 'vscode';
import type { BrowserSession } from '../session/browser-session';
import type { LoginSnapshot } from '../session/login-model';
import type { LoginQrImageProvider } from '../session/login-qr-image-provider';
import { isLoginAssistantMessage, renderLoginAssistantHtml, toLoginAssistantViewState } from './login-assistant-security';
import type { ExtensionLogger } from '../logging';

const INITIAL_SNAPSHOT: LoginSnapshot = {
	status: 'loading',
	message: '正在初始化登录环境并获取二维码…',
	qrRevision: 0,
	expiresAt: 0,
};

const LOGIN_TERMINAL_STATES = new Set<LoginSnapshot['status']>(['logged-in', 'expired', 'qr-unavailable', 'access-restricted', 'page-error', 'verification-required']);

export class LoginAssistant implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly snapshotSubscription: vscode.Disposable;
	private snapshot: LoginSnapshot = INITIAL_SNAPSHOT;
	private webviewReady = false;
	private attemptInFlight = false;

	constructor(private readonly session: BrowserSession, private readonly qrImageProvider: LoginQrImageProvider, private readonly logger?: ExtensionLogger) {
		this.snapshotSubscription = session.onLoginSnapshot(snapshot => this.update(snapshot));
	}

	async open(): Promise<void> {
		if (this.attemptInFlight) {return;}
		this.attemptInFlight = true;
		this.logger?.info('Opening QR login assistant.');
		const panel = this.getPanel();
		this.snapshot = INITIAL_SNAPSHOT;
		this.webviewReady = false;
		panel.webview.html = renderLoginAssistantHtml(this.snapshot);
		try {
			this.update(await this.session.startLogin());
		} catch (error) {
			this.logger?.warn('QR login assistant failed to start: %s.', error instanceof Error ? error.name : 'unknown error');
			this.update({
				status: 'page-error',
				message: error instanceof Error ? error.message : '无法启动无头登录流程。',
				qrRevision: 0,
				expiresAt: 0,
			});
			throw error;
		} finally {
			this.attemptInFlight = false;
			void this.postSnapshot();
		}
	}

	async refreshQr(): Promise<void> {
		if (this.attemptInFlight) {return;}
		this.attemptInFlight = true;
		this.logger?.info('Refreshing login QR.');
		if (!this.panel) {
			this.attemptInFlight = false;
			await this.open();
			return;
		}
		this.update({ status: 'loading', message: '正在请求新的登录二维码…', qrRevision: 0, expiresAt: 0 });
		try {
			this.update(await this.session.refreshLoginQr());
		} catch (error) {
			this.update({
				status: 'page-error',
				message: error instanceof Error ? error.message : '无法刷新二维码。',
				qrRevision: 0,
				expiresAt: 0,
			});
		} finally {
			this.attemptInFlight = false;
			void this.postSnapshot();
		}
	}

	dispose(): void {
		this.snapshotSubscription.dispose();
		this.disposables.forEach(disposable => disposable.dispose());
		this.panel?.dispose();
		this.panel = undefined;
		this.session.stopLogin();
		this.qrImageProvider.clear();
	}

	private getPanel(): vscode.WebviewPanel {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			return this.panel;
		}
		const panel = vscode.window.createWebviewPanel('xiaohongshuFisher.loginAssistant', '小红书扫码登录', vscode.ViewColumn.Active, {
			enableScripts: true,
			localResourceRoots: [],
		});
		this.panel = panel;
		this.disposables.push(panel.webview.onDidReceiveMessage((value: unknown) => this.onMessage(value)));
		this.disposables.push(panel.onDidDispose(() => {
			this.panel = undefined;
			this.session.stopLogin();
			this.qrImageProvider.clear();
		}));
		return panel;
	}

	private async onMessage(value: unknown): Promise<void> {
		if (!isLoginAssistantMessage(value)) {return;}
		if (value.command === 'ready') {
			this.webviewReady = true;
			await this.postSnapshot();
			return;
		}
		if (value.command === 'show-qr') {
			if (!LOGIN_TERMINAL_STATES.has(this.snapshot.status) && this.snapshot.qrPng) {
				await vscode.commands.executeCommand('vscode.open', this.qrImageProvider.getUri(), { preview: false });
			}
			return;
		}
		if (value.command === 'refresh-qr') {
			await this.refreshQr();
			return;
		}
		if (value.command === 'open-official-page') {
			const pageUrl = this.snapshot.pageUrl;
			if (LOGIN_TERMINAL_STATES.has(this.snapshot.status) && pageUrl?.startsWith('https://')) {
				await vscode.env.openExternal(vscode.Uri.parse(pageUrl));
			}
			return;
		}
		this.panel?.dispose();
	}

	private update(snapshot: LoginSnapshot): void {
		if (!this.panel) {return;}
		this.snapshot = snapshot;
		this.qrImageProvider.setImage(LOGIN_TERMINAL_STATES.has(snapshot.status) ? undefined : snapshot.qrPng);
		void this.postSnapshot();
	}

	private async postSnapshot(): Promise<void> {
		if (!this.panel || !this.webviewReady) {return;}
		const state = toLoginAssistantViewState(this.snapshot);
		await this.panel.webview.postMessage({ ...state, attemptInFlight: this.attemptInFlight });
	}
}
