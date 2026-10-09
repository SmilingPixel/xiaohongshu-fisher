import * as vscode from 'vscode';
import type { BrowserSession, LoginSnapshot } from '../session/browser-session';
import type { LoginQrImageProvider } from '../session/login-qr-image-provider';
import { isLoginAssistantMessage, renderLoginAssistantHtml, toLoginAssistantViewState } from './login-assistant-security';
import type { ExtensionLogger } from '../logging';

const INITIAL_SNAPSHOT: LoginSnapshot = {
	status: 'loading',
	message: '正在启动无头浏览器并打开官方登录页…',
	expiresAt: 0,
};

export class LoginAssistant implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly snapshotSubscription: vscode.Disposable;
	private snapshot: LoginSnapshot = INITIAL_SNAPSHOT;
	private webviewReady = false;

	constructor(private readonly session: BrowserSession, private readonly qrImageProvider: LoginQrImageProvider, private readonly logger?: ExtensionLogger) {
		this.snapshotSubscription = session.onLoginSnapshot(snapshot => this.update(snapshot));
	}

	async open(): Promise<void> {
		this.logger?.info('Opening headless login assistant.');
		const panel = this.getPanel();
		this.snapshot = INITIAL_SNAPSHOT;
		this.webviewReady = false;
		panel.webview.html = renderLoginAssistantHtml(this.snapshot);
		try {
			this.update(await this.session.startHeadlessLogin());
		} catch (error) {
			this.logger?.warn('Headless login assistant failed to start: %s.', error instanceof Error ? error.name : 'unknown error');
			this.update({
				status: 'verification-required',
				message: error instanceof Error ? error.message : '无法启动无头登录流程。',
				expiresAt: 0,
			});
			throw error;
		}
	}

	async refreshQr(): Promise<void> {
		this.logger?.info('Refreshing login QR.');
		if (!this.panel) {await this.open(); return;}
		this.update({ status: 'loading', message: '正在向官方页面请求新二维码…', expiresAt: 0 });
		try {
			this.update(await this.session.refreshHeadlessLoginQr());
		} catch (error) {
			this.update({
				status: 'verification-required',
				message: error instanceof Error ? error.message : '无法刷新二维码。',
				expiresAt: 0,
			});
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
			if (this.snapshot.qrImage) {
				await vscode.commands.executeCommand('vscode.open', this.qrImageProvider.getUri(), { preview: false });
			}
			return;
		}
		if (value.command === 'refresh-qr') {
			await this.refreshQr();
			return;
		}
		this.panel?.dispose();
	}

	private update(snapshot: LoginSnapshot): void {
		if (!this.panel) {return;}
		this.snapshot = snapshot;
		this.qrImageProvider.setBase64Image(snapshot.qrImage);
		void this.postSnapshot();
	}

	private async postSnapshot(): Promise<void> {
		if (!this.panel || !this.webviewReady) {return;}
		await this.panel.webview.postMessage(toLoginAssistantViewState(this.snapshot));
	}
}
