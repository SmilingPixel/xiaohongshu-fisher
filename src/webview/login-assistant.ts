import * as vscode from 'vscode';
import type { BrowserSession } from '../session/browser-session';
import type { LoginSnapshot } from '../session/login-model';
import type { LoginQrImageProvider } from '../session/login-qr-image-provider';
import {
	isLoginAssistantMessage,
	renderLoginAssistantHtml,
	toLoginAssistantViewState,
} from './login-assistant-security';
import type { ExtensionLogger } from '../logging';

const INITIAL_SNAPSHOT: LoginSnapshot = {
	status: 'loading',
	message: '正在初始化登录环境并获取二维码…',
	qrRevision: 0,
	expiresAt: 0,
};

/** Coordinates login commands and publishes sanitized state after the WebView's ready handshake. */
export class LoginAssistant implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private readonly panelDisposables: vscode.Disposable[] = [];
	private readonly snapshotSubscription: vscode.Disposable;
	private snapshot: LoginSnapshot = INITIAL_SNAPSHOT;
	private webviewReady = false;
	private attemptInFlight = false;
	private attemptGeneration = 0;

	constructor(
		private readonly session: BrowserSession,
		private readonly qrImageProvider: LoginQrImageProvider,
		private readonly logger?: ExtensionLogger,
	) {
		this.snapshotSubscription = session.onLoginSnapshot((snapshot) => this.update(snapshot));
	}

	async open(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			return;
		}
		this.getPanel();
		await this.runAttempt(false);
	}

	async refreshQr(): Promise<void> {
		if (!this.panel) {
			await this.open();
			return;
		}
		await this.runAttempt(true);
	}

	dispose(): void {
		this.snapshotSubscription.dispose();
		this.panel?.dispose();
		this.session.stopLogin();
		this.qrImageProvider.clear();
	}

	private async runAttempt(refresh: boolean): Promise<void> {
		if (this.attemptInFlight) {
			return;
		}
		const generation = ++this.attemptGeneration;
		this.attemptInFlight = true;
		this.logger?.info(refresh ? 'Refreshing login QR.' : 'Opening QR login assistant.');
		this.update({
			...INITIAL_SNAPSHOT,
			message: refresh ? '正在请求新的登录二维码…' : INITIAL_SNAPSHOT.message,
		});
		try {
			const snapshot = await (refresh ? this.session.refreshLoginQr() : this.session.startLogin());
			if (generation === this.attemptGeneration) {
				this.update(snapshot);
			}
		} catch (error) {
			if (generation !== this.attemptGeneration) {
				return;
			}
			this.logger?.warn(
				'QR login assistant failed to start: %s.',
				error instanceof Error ? error.name : 'unknown error',
			);
			this.update({
				status: 'page-error',
				message: error instanceof Error ? error.message : '无法启动登录流程。',
				qrRevision: 0,
				expiresAt: 0,
			});
			if (!refresh) {
				throw error;
			}
		} finally {
			// Closing and reopening must not let an old attempt replace the new panel's state.
			if (generation === this.attemptGeneration) {
				this.attemptInFlight = false;
				void this.postSnapshot();
			}
		}
	}

	private getPanel(): vscode.WebviewPanel {
		const panel = vscode.window.createWebviewPanel(
			'xiaohongshuFisher.loginAssistant',
			'小红书扫码登录',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				localResourceRoots: [this.qrImageProvider.getUri().with({ path: '/', query: '' })],
			},
		);
		this.panel = panel;
		this.snapshot = INITIAL_SNAPSHOT;
		this.webviewReady = false;
		this.panelDisposables.push(
			panel.webview.onDidReceiveMessage((value: unknown) => this.onMessage(value)),
			panel.onDidDispose(() => {
				this.panel = undefined;
				this.webviewReady = false;
				this.attemptGeneration++;
				this.attemptInFlight = false;
				this.snapshot = INITIAL_SNAPSHOT;
				this.session.stopLogin();
				this.qrImageProvider.clear();
				this.panelDisposables.splice(0).forEach((disposable) => disposable.dispose());
			}),
		);
		panel.webview.html = renderLoginAssistantHtml(this.snapshot, panel.webview.cspSource);
		return panel;
	}

	private async onMessage(value: unknown): Promise<void> {
		if (!isLoginAssistantMessage(value)) {
			return;
		}
		if (value.command === 'ready') {
			this.webviewReady = true;
			await this.postSnapshot();
			return;
		}
		if (value.command === 'refresh-qr') {
			await this.refreshQr();
			return;
		}
		if (value.command === 'open-official-page') {
			const pageUrl = toLoginAssistantViewState(this.snapshot).pageUrl;
			if (pageUrl) {
				await vscode.env.openExternal(vscode.Uri.parse(pageUrl));
			}
			return;
		}
		this.panel?.dispose();
	}

	private update(snapshot: LoginSnapshot): void {
		if (!this.panel) {
			return;
		}
		this.snapshot = snapshot;
		this.qrImageProvider.setImage(snapshot.status === 'waiting-scan' ? snapshot.qrPng : undefined);
		void this.postSnapshot();
	}

	private async postSnapshot(): Promise<void> {
		if (!this.panel || !this.webviewReady) {
			return;
		}
		const qrImageUri = this.panel.webview.asWebviewUri(this.qrImageProvider.getUri()).toString();
		const state = toLoginAssistantViewState(this.snapshot, qrImageUri);
		await this.panel.webview.postMessage({ ...state, attemptInFlight: this.attemptInFlight });
	}
}
