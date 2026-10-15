import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page, Response } from 'playwright';
import { chromium } from 'playwright';
import * as vscode from 'vscode';
import { diagnoseBrowserStartup, type BrowserMode } from './browser-startup';
import { detectLoginState, isAuthenticatedUserResponse, type LoginDetection } from './login-state';
import { LOGIN_TERMINAL_STATES, type LoginSnapshot, type LoginStatus } from './login-model';
import { LoginQrClient, type LoginQrFailure } from './login-qr-client';
import { renderLoginQrPng } from './login-qr-renderer';
import type { LoginQrChallenge } from './login-qr';
import { classifyOfficialErrorRedirect, type OfficialPageError } from '../sources/official-page-error';
import type { ExtensionLogger } from '../logging';

const LOGIN_URL = 'https://www.xiaohongshu.com/login';
const USER_ENDPOINT = 'https://edith.xiaohongshu.com/api/sns/web/v2/user/me';
const USER_RESPONSE_LIMIT = 64 * 1024;
const PROFILE_DIRECTORY = 'browser-profile';
const LOGIN_POLL_INTERVAL = 2_000;
const LOGIN_QR_LIFETIME = 120_000;
const LOGIN_QR_WAIT_TIMEOUT = 30_000;

export type { LoginSnapshot, LoginStatus } from './login-model';
type LoginSnapshotListener = (snapshot: LoginSnapshot) => void;

/** Owns the persistent session and coordinates direct QR creation with the official page's login confirmation. */
export class BrowserSession implements vscode.Disposable {
	private context?: BrowserContext;
	private opening?: Promise<BrowserContext>;
	private browserMode?: BrowserMode;
	private loginPage?: Page;
	private qrClient?: LoginQrClient;
	private readonly profilePath: string;
	private readonly loginListeners = new Set<LoginSnapshotListener>();
	private readonly authenticatedPages = new WeakSet<Page>();
	private loginPoll?: NodeJS.Timeout;
	private loginPollInFlight = false;
	private loginExpiresAt = 0;
	private loginPng?: Uint8Array;
	private loginRevision = 0;
	private lastChallenge?: LoginQrChallenge;
	private lastLoginSnapshot?: LoginSnapshot;
	private loginGeneration = 0;

	constructor(
		storageUri: vscode.Uri,
		private readonly logger?: ExtensionLogger,
		private readonly getBrowserMode: () => BrowserMode = () => 'window',
	) { this.profilePath = path.join(storageUri.fsPath, PROFILE_DIRECTORY); }
	onLoginSnapshot(listener: LoginSnapshotListener): vscode.Disposable { this.loginListeners.add(listener); return { dispose: () => this.loginListeners.delete(listener) }; }

	async startLogin(): Promise<LoginSnapshot> { return this.beginLoginAttempt('start'); }
	async refreshLoginQr(): Promise<LoginSnapshot> { return this.beginLoginAttempt('refresh'); }

	stopLogin(): void {
		this.loginGeneration++;
		this.stopLoginPolling();
		this.qrClient?.dispose(); this.qrClient = undefined;
		this.clearLoginMaterial();
		const page = this.loginPage; this.loginPage = undefined;
		if (page) { void page.close().catch(() => undefined); }
	}
	async openPage(): Promise<Page> {
		const page = await (await this.getContext()).newPage();
		await this.minimizeWindow(page);
		return page;
	}
	async clear(): Promise<void> { this.logger?.info('Clearing extension-owned browser session.'); this.stopLogin(); await this.closeContext(); await rm(this.profilePath, { recursive: true, force: true }); }
	async dispose(): Promise<void> { this.stopLogin(); await this.closeContext(); this.loginListeners.clear(); }

	private async beginLoginAttempt(operation: 'start' | 'refresh'): Promise<LoginSnapshot> {
		const generation = ++this.loginGeneration;
		this.stopLoginPolling(); this.qrClient?.dispose(); this.qrClient = undefined; this.clearLoginMaterial();
		const oldPage = this.loginPage; this.loginPage = undefined;
		if (oldPage) { await oldPage.close().catch(() => undefined); }
		if (generation !== this.loginGeneration) {return this.cancelledLoginSnapshot();}
		this.lastLoginSnapshot = undefined;
		this.emitLoginSnapshot(this.toLoginSnapshot({ status: 'loading', message: '正在初始化登录环境并获取二维码…' }));
		const context = await this.getContext();
		if (generation !== this.loginGeneration) {return this.cancelledLoginSnapshot();}
		const page = await context.newPage();
		await this.minimizeWindow(page);
		if (generation !== this.loginGeneration) {await page.close().catch(() => undefined); return this.cancelledLoginSnapshot();}
		this.loginPage = page;
		page.on('close', () => {
			if (page === this.loginPage && generation === this.loginGeneration) {
				this.publishTerminal({ status: 'page-error', message: '登录浏览器页面已关闭，请重新打开扫码登录。' }, 'login-close');
			}
		});
		this.qrClient = new LoginQrClient(page,
			challenge => { void this.acceptChallenge(challenge, page, generation); },
			failure => {
				if (!this.inactiveLoginSnapshot(page, generation)) {this.publishQrFailure(failure);}
			});
		page.on('response', response => {
			if (response.url().split('?')[0] === USER_ENDPOINT) {
				void this.readLoginUserResponse(response, page, generation);
				return;
			}
			if (response.url() !== 'https://edith.xiaohongshu.com/api/sns/web/v1/login/activate' || this.inactiveLoginSnapshot(page, generation)) {return;}
			this.logger?.info('Official session activation responded (mode: %s, HTTP status: %s).', this.browserMode, response.status());
			if (response.status() >= 400) {
				this.publishTerminal({
					status: [401, 403, 406, 429, 461, 471].includes(response.status()) ? 'access-restricted' : 'page-error',
					message: `官方会话初始化失败（HTTP ${response.status()}），无法继续获取登录二维码。${this.browserMode === 'headless' ? '请在扩展设置中选择普通浏览器模式并重新加载窗口后重试。' : '请按官方提示处理后重试。'}`,
				}, 'login-activate');
			}
		});
		page.on('framenavigated', frame => { if (frame === page.mainFrame() && page === this.loginPage) {this.handleLoginNavigation(page, frame.url(), generation);} });
		try {
			await this.qrClient.install();
			const inactive = this.inactiveLoginSnapshot(page, generation);
			if (inactive) {return inactive;}
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

	/** Existing accounts redirect away from /login without creating a QR or showing logout text. */
	private async readLoginUserResponse(response: Response, page: Page, generation: number): Promise<void> {
		if (!response.ok() || this.inactiveLoginSnapshot(page, generation)) {return;}
		try {
			if (response.frame() !== page.mainFrame()) {return;}
			const headers = response.headers();
			if (!/application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '') || Number(headers['content-length']) > USER_RESPONSE_LIMIT) {return;}
			const body = await response.body();
			if (body.byteLength > USER_RESPONSE_LIMIT || this.inactiveLoginSnapshot(page, generation)) {return;}
			// Retain only authentication evidence, never account data or cookies.
			if (isAuthenticatedUserResponse(JSON.parse(body.toString('utf8')) as unknown)) {
				this.authenticatedPages.add(page);
				this.logger?.info('Official session status confirmed (state: logged-in).');
			}
		} catch { /* A failed or malformed response is not evidence of authentication. */ }
	}

	private async acceptChallenge(challenge: LoginQrChallenge, page: Page, generation: number): Promise<void> {
		if (generation !== this.loginGeneration || page !== this.loginPage || LOGIN_TERMINAL_STATES.has(this.lastLoginSnapshot?.status ?? 'loading')) {return;}
		if (this.lastChallenge?.id === challenge.id && this.lastChallenge.code === challenge.code) {return;}
		this.lastChallenge = challenge;
		try {
			const png = await renderLoginQrPng(challenge);
			if (generation !== this.loginGeneration || page !== this.loginPage) {png.fill(0); return;}
			this.logger?.info('Login QR created from the direct API response.');
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
				const diagnostics = this.qrClient?.getDiagnostics();
				this.logger?.warn('Login QR acquisition timed out (request sent: %s, response received: %s, failure: %s).', diagnostics?.requestSent ?? false, diagnostics?.responseReceived ?? false, diagnostics?.failure ?? 'none');
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
		const detection = detectLoginState({ url, bodyText, hasQr: Boolean(this.loginPng), authenticated: this.authenticatedPages.has(page) || /退出登录/.test(bodyText), now: Date.now(), expiresAt: this.loginExpiresAt });
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
	private publishQrFailure(failure: LoginQrFailure): LoginSnapshot {
		this.logger?.warn('Direct QR creation failed (reason: %s, HTTP status: %s).', failure.reason, failure.httpStatus ?? 'none');
		if (failure.reason === 'request-rejected') {
			return this.publishTerminal({
				status: [401, 403, 406, 429].includes(failure.httpStatus ?? 0) ? 'access-restricted' : 'page-error',
				message: `官方二维码接口请求失败（HTTP ${failure.httpStatus}）。请按官方提示检查会话或网络后重试。`,
			}, 'login-create');
		}
		const message = failure.reason === 'timeout'
			? '请求官方二维码接口超时，请检查运行扩展的主机所使用的网络后重试。'
			: failure.reason === 'network'
				? '无法完成官方二维码接口请求，请检查运行扩展的主机所使用的网络后重试。'
				: '官方二维码接口返回了无法识别的数据，请稍后重试。';
		return this.publishTerminal({ status: 'qr-unavailable', message }, 'login-create');
	}
	private publishOfficialPageError(error: OfficialPageError, operation: string): LoginSnapshot { this.logger?.warn('Official page redirect detected (operation: %s, kind: %s, code: %s).', operation, error.kind, error.platformCode ?? 'unknown'); return this.publishTerminal({ status: error.kind === 'ip-risk' ? 'access-restricted' : 'page-error', message: error.message }, operation); }
	private publishTerminal(detection: LoginDetection, operation: string): LoginSnapshot {
		this.stopLoginPolling(); this.qrClient?.dispose(); this.qrClient = undefined; this.clearLoginMaterial();
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
		if (!this.opening) {
			this.opening = this.launchContext().then(context => {
				this.context = context;
				context.on('close', () => {
					if (this.context === context) {
						this.context = undefined;
						if (this.loginPage) {this.publishTerminal({ status: 'page-error', message: '浏览器会话已关闭，请重新打开扫码登录。' }, 'browser-close');}
					}
				});
				return context;
			}).finally(() => { this.opening = undefined; });
		}
		return this.opening;
	}
	private async launchContext(): Promise<BrowserContext> {
		const mode = this.getBrowserMode();
		this.browserMode = mode;
		this.logger?.info('Launching persistent Chromium browser (mode: %s).', mode);
		try {
			await mkdir(this.profilePath, { recursive: true });
			const userAgent = mode === 'headless' ? await this.getHeadlessUserAgent() : undefined;
			const context = await chromium.launchPersistentContext(this.profilePath, {
				headless: mode === 'headless',
				userAgent,
			});
			for (const page of context.pages()) {await this.minimizeWindow(page);}
			return context;
		} catch (error) {
			const failure = diagnoseBrowserStartup(error, mode);
			this.logger?.error('Chromium launch failed (platform: %s, mode: %s, category: %s, missing libraries: %s).', process.platform, mode, failure.category, failure.missingLibraries.join(', ') || 'none detected');
			throw failure.error;
		}
	}

	/** Use the installed runtime's UA so its version and platform stay current. */
	private async getHeadlessUserAgent(): Promise<string> {
		const browser = await chromium.launch({ headless: true });
		try {
			const connection = await browser.newBrowserCDPSession();
			const { userAgent } = await connection.send('Browser.getVersion');
			// The default HeadlessChrome token causes session activation to be rejected.
			// Set the context UA, keeping request headers and navigator.userAgent aligned
			// for every login/content page without modifying other browser properties.
			this.logger?.debug('Headless Chromium User-Agent configured (source: runtime).');
			return userAgent.replace('HeadlessChrome/', 'Chrome/');
		} finally { await browser.close(); }
	}

	/** Keep one real browser environment for login and reading; request minimization where the window manager supports it. */
	private async minimizeWindow(page: Page): Promise<void> {
		if (this.browserMode !== 'window') {return;}
		let connection: import('playwright').CDPSession | undefined;
		try {
			connection = await page.context().newCDPSession(page);
			const { windowId } = await connection.send('Browser.getWindowForTarget');
			await connection.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
			const { bounds } = await connection.send('Browser.getWindowBounds', { windowId });
			this.logger?.debug('Browser window minimization requested (reported state: %s).', bounds.windowState);
		} catch {
			if (!page.isClosed()) {this.logger?.debug('Browser window could not be minimized; the visible session remains available.');}
		} finally { await connection?.detach().catch(() => undefined); }
	}
	private async closeContext(): Promise<void> {
		const context = this.context ?? await this.opening?.catch(() => undefined);
		this.context = undefined;
		this.loginPage = undefined;
		this.qrClient?.dispose(); this.qrClient = undefined;
		if (context) {await context.close().catch(() => undefined);}
	}
}
