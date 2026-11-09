import * as vscode from 'vscode';
import type { BrowserSession } from '../session/browser-session';
import type { LoginSnapshot } from '../session/login-model';
import type { LoginQrImageProvider } from '../session/login-qr-image-provider';
import {
	isLoginAssistantMessage,
	renderLoginAssistantHtml,
	toLoginAssistantViewState,
} from './login-assistant-security';
import { SourceError } from '../models/source-error';
import type { ExtensionLogger } from '../logging';

function initialSnapshot(): LoginSnapshot {
	return {
		status: 'loading',
		message: vscode.l10n.t('Initializing the login environment and fetching a QR code…'),
		qrRevision: 0,
		expiresAt: 0,
	};
}

/** Coordinates login commands and publishes sanitized state after the WebView's ready handshake. */
export class LoginAssistant implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private readonly panelDisposables: vscode.Disposable[] = [];
	private readonly snapshotSubscription: vscode.Disposable;
	private snapshot: LoginSnapshot = initialSnapshot();
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
			...initialSnapshot(),
			message: refresh
				? vscode.l10n.t('Requesting a new login QR code…')
				: initialSnapshot().message,
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
				'QR login assistant failed to start (code: %s).',
				error instanceof SourceError ? error.code : 'unknown',
			);
			this.update({
				status: 'page-error',
				message:
					error instanceof SourceError ? error.message : vscode.l10n.t('Unable to start login.'),
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
			vscode.l10n.t('Xiaohongshu QR Login'),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				localResourceRoots: [this.qrImageProvider.getUri().with({ path: '/', query: '' })],
			},
		);
		this.panel = panel;
		this.snapshot = initialSnapshot();
		this.webviewReady = false;
		this.panelDisposables.push(
			panel.webview.onDidReceiveMessage((value: unknown) => this.onMessage(value)),
			panel.onDidDispose(() => {
				this.panel = undefined;
				this.webviewReady = false;
				this.attemptGeneration++;
				this.attemptInFlight = false;
				this.snapshot = initialSnapshot();
				this.session.stopLogin();
				this.qrImageProvider.clear();
				this.panelDisposables.splice(0).forEach((disposable) => disposable.dispose());
			}),
		);
		panel.webview.html = renderLoginAssistantHtml(
			this.snapshot,
			panel.webview.cspSource,
			vscode.env.language,
		);
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
