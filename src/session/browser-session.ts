import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import * as vscode from 'vscode';
import { diagnoseBrowserStartup } from './browser-startup';
import { detectLoginState, type LoginDetection } from './login-state';
import { LOGIN_TERMINAL_STATES, type LoginSnapshot, type LoginStatus } from './login-model';
import { LoginQrObserver } from './login-qr-observer';
import { renderLoginQrPng } from './login-qr-renderer';
import type { LoginQrChallenge } from './login-qr';
import { classifyOfficialErrorRedirect, type OfficialPageError } from '../sources/official-page-error';
import type { ExtensionLogger } from '../logging';

const LOGIN_URL = 'https://www.xiaohongshu.com/login';
const PROFILE_DIRECTORY = 'browser-profile';
const LOGIN_POLL_INTERVAL = 2_000;
const LOGIN_QR_LIFETIME = 120_000;
const LOGIN_QR_WAIT_TIMEOUT = 30_000;

export type { LoginSnapshot, LoginStatus } from './login-model';
type LoginSnapshotListener = (snapshot: LoginSnapshot) => void;

/** Owns the persistent browser context and the page that completes the official QR login flow. */
export class BrowserSession implements vscode.Disposable {
	private context?: BrowserContext;
	private opening?: Promise<BrowserContext>;
	private loginPage?: Page;
	private observer?: LoginQrObserver;
	private readonly profilePath: string;
	private readonly loginListeners = new Set<LoginSnapshotListener>();
	private loginPoll?: NodeJS.Timeout;
	private loginPollInFlight = false;
	private loginExpiresAt = 0;
	private loginPng?: Uint8Array;
	private loginRevision = 0;
	private lastChallenge?: LoginQrChallenge;
	private lastLoginSnapshot?: LoginSnapshot;
	private loginGeneration = 0;

	constructor(storageUri: vscode.Uri, private readonly logger?: ExtensionLogger) { this.profilePath = path.join(storageUri.fsPath, PROFILE_DIRECTORY); }
	onLoginSnapshot(listener: LoginSnapshotListener): vscode.Disposable { this.loginListeners.add(listener); return { dispose: () => this.loginListeners.delete(listener) }; }

	async startLogin(): Promise<LoginSnapshot> { return this.beginLoginAttempt('start'); }
	async refreshLoginQr(): Promise<LoginSnapshot> { return this.beginLoginAttempt('refresh'); }

	stopLogin(): void {
		this.loginGeneration++;
		this.stopLoginPolling();
		this.observer?.dispose(); this.observer = undefined;
		this.clearLoginMaterial();
		const page = this.loginPage; this.loginPage = undefined;
		if (page) { void page.close().catch(() => undefined); }
	}
	async openPage(): Promise<Page> { return (await this.getContext()).newPage(); }
	async clear(): Promise<void> { this.logger?.info('Clearing extension-owned browser session.'); this.stopLogin(); await this.closeContext(); await rm(this.profilePath, { recursive: true, force: true }); }
	async dispose(): Promise<void> { this.stopLogin(); await this.closeContext(); this.loginListeners.clear(); }

	private async beginLoginAttempt(operation: 'start' | 'refresh'): Promise<LoginSnapshot> {
		const generation = ++this.loginGeneration;
		this.stopLoginPolling(); this.observer?.dispose(); this.observer = undefined; this.clearLoginMaterial();
		const oldPage = this.loginPage; this.loginPage = undefined;
		if (oldPage) { await oldPage.close().catch(() => undefined); }
		if (generation !== this.loginGeneration) {return this.cancelledLoginSnapshot();}
		this.lastLoginSnapshot = undefined;
		this.emitLoginSnapshot(this.toLoginSnapshot({ status: 'loading', message: '正在启动无头浏览器并打开官方登录页…' }));
		const context = await this.getContext();
		if (generation !== this.loginGeneration) {return this.cancelledLoginSnapshot();}
		const page = await context.newPage();
		if (generation !== this.loginGeneration) {await page.close().catch(() => undefined); return this.cancelledLoginSnapshot();}
		this.loginPage = page;
		this.observer = new LoginQrObserver(page,
			challenge => { void this.acceptChallenge(challenge, page, generation); },
			failure => {
				if (!this.inactiveLoginSnapshot(page, generation)) {this.logger?.warn('QR creation failed (reason: %s).', failure);}
			});
		page.on('framenavigated', frame => { if (frame === page.mainFrame() && page === this.loginPage) {this.handleLoginNavigation(page, frame.url(), generation);} });
		try {
			await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
			const snapshot = await this.waitForLoginSnapshot(page, generation);
			if (generation !== this.loginGeneration) {return this.cancelledLoginSnapshot();}
			this.logger?.info('QR login %s; initial state: %s.', operation, snapshot.status);
			if (this.canContinueLogin(snapshot.status)) {this.startLoginPolling(generation);}
			return snapshot;
		} catch (error) {
			const inactive = this.inactiveLoginSnapshot(page, generation);
			if (inactive) {return inactive;}
			this.logger?.warn('Login navigation failed (category: %s).', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
			return this.publishTerminal({ status: 'page-error', message: '暂时无法打开官方登录页，请检查运行扩展的主机所使用的网络后重试。' }, 'login-navigation');
		}
	}

	private async acceptChallenge(challenge: LoginQrChallenge, page: Page, generation: number): Promise<void> {
		if (generation !== this.loginGeneration || page !== this.loginPage || LOGIN_TERMINAL_STATES.has(this.lastLoginSnapshot?.status ?? 'loading')) {return;}
		if (this.lastChallenge?.id === challenge.id && this.lastChallenge.code === challenge.code) {return;}
		this.lastChallenge = challenge;
		try {
			const png = await renderLoginQrPng(challenge);
			if (generation !== this.loginGeneration || page !== this.loginPage) {png.fill(0); return;}
			this.loginPng?.fill(0); this.loginPng = png; this.loginRevision++;
			if (this.loginExpiresAt === 0) {this.loginExpiresAt = Date.now() + LOGIN_QR_LIFETIME;}
			this.emitLoginSnapshot(this.toLoginSnapshot({ status: 'waiting-scan', message: '请使用小红书手机客户端扫描二维码并确认登录。' }));
		} catch {
			if (this.inactiveLoginSnapshot(page, generation)) {return;}
			this.publishTerminal({ status: 'qr-unavailable', message: '无法生成登录二维码，请刷新后重试。' }, 'qr-render');
		}
	}

	private startLoginPolling(generation: number): void { this.stopLoginPolling(); this.loginPoll = setInterval(() => { void this.pollLogin(generation); }, LOGIN_POLL_INTERVAL); }
	private stopLoginPolling(): void { if (this.loginPoll) {clearInterval(this.loginPoll);} this.loginPoll = undefined; }

	private async pollLogin(generation: number): Promise<void> {
		if (this.loginPollInFlight || generation !== this.loginGeneration || !this.loginPage || this.loginPage.isClosed()) {return;}
		const page = this.loginPage;
		this.loginPollInFlight = true;
		try {
			const snapshot = await this.inspectLoginPage(page, generation);
			if (this.inactiveLoginSnapshot(page, generation)) {return;}
			this.emitLoginSnapshot(snapshot);
			if (!this.canContinueLogin(snapshot.status)) {this.stopLoginPolling();}
		} catch {
			if (this.inactiveLoginSnapshot(page, generation)) {return;}
			this.stopLoginPolling(); this.publishTerminal({ status: 'page-error', message: '暂时无法读取官方登录页，已暂停登录。请检查网络后手动重试。' }, 'login-poll');
		} finally { this.loginPollInFlight = false; }
	}

	private async waitForLoginSnapshot(page: Page, generation: number): Promise<LoginSnapshot> {
		const deadline = Date.now() + LOGIN_QR_WAIT_TIMEOUT;
		while (true) {
			const snapshot = await this.inspectLoginPage(page, generation);
			const inactive = this.inactiveLoginSnapshot(page, generation);
			if (inactive) {return inactive;}
			if (snapshot.status !== 'loading') {return snapshot;}
			if (Date.now() >= deadline) {
				const diagnostics = this.observer?.getDiagnostics();
				this.logger?.warn('Login QR acquisition timed out (request started: %s, response received: %s, failure: %s).', diagnostics?.requestStarted ?? false, diagnostics?.responseReceived ?? false, diagnostics?.failure ?? 'none');
				return this.publishTerminal({ status: 'qr-unavailable', message: '未能在规定时间内获取官方二维码，请检查运行扩展的主机所使用的网络后重试。可在“输出 → Xiaohongshu Fisher”查看请求诊断。' }, 'login-acquisition');
			}
			await new Promise(resolve => setTimeout(resolve, 300));
		}
	}

	private async inspectLoginPage(page: Page, generation: number): Promise<LoginSnapshot> {
		const inactive = this.inactiveLoginSnapshot(page, generation);
		if (inactive) {return inactive;}
		const url = page.url(); const redirect = classifyOfficialErrorRedirect(url);
		if (redirect) {return this.publishOfficialPageError(redirect, 'login-inspection');}
		let bodyText = '';
		try { bodyText = await page.locator('body').innerText({ timeout: 1_500 }); } catch { /* transient navigation */ }
		const stopped = this.inactiveLoginSnapshot(page, generation);
		if (stopped) {return stopped;}
		const detection = detectLoginState({ url, bodyText, hasQr: Boolean(this.loginPng), authenticated: /退出登录/.test(bodyText), now: Date.now(), expiresAt: this.loginExpiresAt });
		if (LOGIN_TERMINAL_STATES.has(detection.status)) {return this.publishTerminal(detection, 'login-inspection');}
		if (detection.status === 'waiting-scan' && !this.loginPng) {return this.toLoginSnapshot({ status: 'loading', message: '正在等待官方登录二维码…' });}
		return this.toLoginSnapshot(detection);
	}

	/** Navigation can close the page during any await; preserve its terminal reason and isolate older attempts. */
	private inactiveLoginSnapshot(page: Page, generation: number): LoginSnapshot | undefined {
		if (generation !== this.loginGeneration) {return this.cancelledLoginSnapshot();}
		if (this.lastLoginSnapshot && LOGIN_TERMINAL_STATES.has(this.lastLoginSnapshot.status)) {return this.lastLoginSnapshot;}
		if (page !== this.loginPage) {return this.cancelledLoginSnapshot();}
		return undefined;
	}
	private cancelledLoginSnapshot(): LoginSnapshot { return { status: 'loading', message: '登录操作已取消。', qrRevision: 0, expiresAt: 0 }; }

	private handleLoginNavigation(page: Page, url: string, generation: number): void {
		if (generation !== this.loginGeneration || url === 'about:blank') {return;}
		const error = classifyOfficialErrorRedirect(url); if (error) {this.publishOfficialPageError(error, 'login-navigation'); return;}
		if (!this.isTrustedLoginPage(url)) {this.publishTerminal({ status: 'page-error', message: '登录页跳转到了不受支持的地址，已停止读取。请检查官方页面后重新打开登录。' }, 'login-navigation');}
	}
	private publishOfficialPageError(error: OfficialPageError, operation: string): LoginSnapshot { this.logger?.warn('Official page redirect detected (operation: %s, kind: %s, code: %s).', operation, error.kind, error.platformCode ?? 'unknown'); return this.publishTerminal({ status: error.kind === 'ip-risk' ? 'access-restricted' : 'page-error', message: error.message }, operation); }
	private publishTerminal(detection: LoginDetection, operation: string): LoginSnapshot {
		this.stopLoginPolling(); this.observer?.dispose(); this.observer = undefined; this.clearLoginMaterial();
		const page = this.loginPage; this.loginPage = undefined;
		if (page) {void page.close().catch(() => undefined);}
		const snapshot = this.toLoginSnapshot(detection); this.logger?.info('Login attempt stopped (operation: %s, state: %s).', operation, detection.status); this.emitLoginSnapshot(snapshot); return snapshot;
	}
	private clearLoginMaterial(): void { this.loginPng?.fill(0); this.loginPng = undefined; this.lastChallenge = undefined; this.loginExpiresAt = 0; this.loginRevision++; }
	private canContinueLogin(status: LoginStatus): boolean { return status === 'loading' || status === 'waiting-scan'; }
	private isTrustedLoginPage(value: string): boolean { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com')); } catch { return false; } }
	private toLoginSnapshot(detection: LoginDetection): LoginSnapshot {
		const pageUrl = detection.status === 'access-restricted' || detection.status === 'page-error'
			? 'https://www.xiaohongshu.com/'
			: undefined;
		return { status: detection.status, message: detection.message, qrPng: this.loginPng, qrRevision: this.loginRevision, expiresAt: this.loginExpiresAt, pageUrl };
	}
	private emitLoginSnapshot(snapshot: LoginSnapshot): void {
		if (this.lastLoginSnapshot && this.lastLoginSnapshot.status === snapshot.status && this.lastLoginSnapshot.message === snapshot.message && this.lastLoginSnapshot.qrRevision === snapshot.qrRevision && this.lastLoginSnapshot.expiresAt === snapshot.expiresAt) {return;}
		this.lastLoginSnapshot = snapshot; for (const listener of this.loginListeners) {listener(snapshot);}
	}
	private async getContext(): Promise<BrowserContext> {
		if (this.context && !this.context.browser()?.isConnected()) {this.context = undefined;}
		if (this.context) {return this.context;}
		if (!this.opening) {this.opening = this.launchContext();}
		try { this.context = await this.opening; this.context.on('close', () => {this.context = undefined; this.stopLogin();}); return this.context; } finally {this.opening = undefined;}
	}
	private async launchContext(): Promise<BrowserContext> { this.logger?.info('Launching persistent headless Chromium browser.'); try { await mkdir(this.profilePath, { recursive: true }); return await chromium.launchPersistentContext(this.profilePath, { headless: true }); } catch (error) { const failure = diagnoseBrowserStartup(error); this.logger?.error('Chromium launch failed (platform: %s, category: %s, missing libraries: %s).', process.platform, failure.category, failure.missingLibraries.join(', ') || 'none detected'); throw failure.error; } }
	private async closeContext(): Promise<void> { const context = this.context; this.context = undefined; this.loginPage = undefined; this.observer?.dispose(); this.observer = undefined; if (context) {await context.close().catch(() => undefined);} }
}
