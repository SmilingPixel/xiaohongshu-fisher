import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import * as vscode from 'vscode';
import { SourceError } from '../models/source-error';
import { resolveBrowserMode, type BrowserMode, type ResolvedBrowserMode } from './browser-mode';
import { diagnoseBrowserStartup } from './browser-startup';
import { detectLoginState, type LoginDetection, type LoginStatus } from './login-state';
import { classifyOfficialErrorRedirect, type OfficialPageError } from '../sources/official-page-error';
import type { ExtensionLogger } from '../logging';

const HOME_URL = 'https://www.xiaohongshu.com/';
const LOGIN_URL = 'https://www.xiaohongshu.com/login';
const PROFILE_DIRECTORY = 'browser-profile';
const LOGIN_POLL_INTERVAL = 2_000;
const LOGIN_IMAGE_REFRESH_INTERVAL = 10_000;
const LOGIN_QR_LIFETIME = 2 * 60 * 1_000;
const LOGIN_QR_WAIT_TIMEOUT = 15_000;
const LOGIN_IMAGE_LIMIT = 1_024 * 1_024;

export interface LoginSnapshot {
	readonly status: LoginStatus;
	readonly message: string;
	readonly qrImage?: string;
	readonly expiresAt: number;
}

type LoginSnapshotListener = (snapshot: LoginSnapshot) => void;

export class BrowserSession implements vscode.Disposable {
	private context?: BrowserContext;
	private opening?: Promise<BrowserContext>;
	private loginPage?: Page;
	private readonly profilePath: string;
	private readonly mode: ResolvedBrowserMode;
	private readonly loginListeners = new Set<LoginSnapshotListener>();
	private loginPoll?: NodeJS.Timeout;
	private loginPollInFlight = false;
	private loginExpiresAt = 0;
	private loginImage?: string;
	private loginImageCapturedAt = 0;
	private lastLoginSnapshot?: LoginSnapshot;
	private loginGeneration = 0;

	constructor(storageUri: vscode.Uri, configuredMode: BrowserMode = 'auto', private readonly logger?: ExtensionLogger) {
		this.profilePath = path.join(storageUri.fsPath, PROFILE_DIRECTORY);
		this.mode = resolveBrowserMode(configuredMode, {
			display: process.env.DISPLAY,
			waylandDisplay: process.env.WAYLAND_DISPLAY,
			remote: Boolean(vscode.env.remoteName),
			platform: process.platform,
		});
	}

	getMode(): ResolvedBrowserMode {
		return this.mode;
	}

	onLoginSnapshot(listener: LoginSnapshotListener): vscode.Disposable {
		this.loginListeners.add(listener);
		return { dispose: () => this.loginListeners.delete(listener) };
	}

	async openLogin(): Promise<void> {
		this.logger?.info('Opening official login page in %s browser.', this.mode);
		const context = await this.getContext();
		const page = await this.getLoginPage(context);
		this.stopLoginPolling();
		this.loginGeneration++;
		this.loginExpiresAt = 0;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		this.lastLoginSnapshot = undefined;
		await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
		if (this.mode === 'visible') {await page.bringToFront();}
	}

	async startHeadlessLogin(): Promise<LoginSnapshot> {
		if (this.mode !== 'headless') {
			throw new SourceError('browser-startup', '当前浏览器模式不是无头模式。', false);
		}
		const page = await this.getLoginPage(await this.getContext());
		this.stopLoginPolling();
		const generation = ++this.loginGeneration;
		await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
		this.loginExpiresAt = 0;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		this.lastLoginSnapshot = undefined;
		const snapshot = await this.waitForLoginSnapshot(page, generation);
		this.logger?.info('Headless login started; initial state: %s.', snapshot.status);
		this.emitLoginSnapshot(snapshot);
		if (this.canContinueLogin(snapshot.status)) {
			this.startLoginPolling();
		}
		return snapshot;
	}

	async refreshHeadlessLoginQr(): Promise<LoginSnapshot> {
		if (this.mode !== 'headless') {
			throw new SourceError('browser-startup', '当前浏览器模式不是无头模式。', false);
		}
		const page = await this.getLoginPage(await this.getContext());
		this.stopLoginPolling();
		const generation = ++this.loginGeneration;
		this.loginExpiresAt = 0;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
		const snapshot = await this.waitForLoginSnapshot(page, generation);
		this.logger?.info('Headless login QR refreshed; state: %s.', snapshot.status);
		this.emitLoginSnapshot(snapshot);
		if (this.canContinueLogin(snapshot.status)) {
			this.startLoginPolling();
		}
		return snapshot;
	}

	stopLogin(): void {
		this.logger?.debug('Stopping login polling and closing login page.');
		this.stopLoginPolling();
		this.loginGeneration++;
		this.loginExpiresAt = 0;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		this.lastLoginSnapshot = undefined;
		const page = this.loginPage;
		this.loginPage = undefined;
		if (page) {void page.close().catch(() => undefined);}
	}

	async openPage(): Promise<Page> {
		return (await this.getContext()).newPage();
	}

	async clear(): Promise<void> {
		this.logger?.info('Clearing extension-owned browser session.');
		this.stopLogin();
		await this.closeContext();
		await rm(this.profilePath, { recursive: true, force: true });
	}

	async dispose(): Promise<void> {
		this.logger?.debug('Disposing browser session.');
		this.stopLogin();
		await this.closeContext();
		this.loginListeners.clear();
	}

	private async getContext(): Promise<BrowserContext> {
		if (this.context && !this.context.browser()?.isConnected()) {
			this.context = undefined;
		}
		if (this.context) {return this.context;}
		if (!this.opening) {
			this.opening = this.launchContext();
		}
		try {
			this.context = await this.opening;
			this.context.on('close', () => {
				this.context = undefined;
				this.loginPage = undefined;
			});
			return this.context;
		} finally {
			this.opening = undefined;
		}
	}

	private async getLoginPage(context: BrowserContext): Promise<Page> {
		if (!this.loginPage || this.loginPage.isClosed()) {
			this.loginPage = await context.newPage();
			const page = this.loginPage;
			page.on('framenavigated', frame => {
				if (frame !== page.mainFrame() || page !== this.loginPage) {return;}
				this.handleLoginNavigation(page, frame.url());
			});
		}
		return this.loginPage;
	}

	private startLoginPolling(): void {
		this.stopLoginPolling();
		this.loginPoll = setInterval(() => { void this.pollLogin(); }, LOGIN_POLL_INTERVAL);
	}

	private stopLoginPolling(): void {
		if (this.loginPoll) {clearInterval(this.loginPoll);}
		this.loginPoll = undefined;
	}

	private async pollLogin(): Promise<void> {
		if (this.loginPollInFlight || !this.loginPage || this.loginPage.isClosed()) {return;}
		if (this.loginExpiresAt > 0 && Date.now() >= this.loginExpiresAt) {
			this.logger?.info('Login QR expired.');
			const detection: LoginDetection = { status: 'expired', message: '二维码已过期，请刷新二维码后重试。' };
			this.publishTerminal(detection, 'login-poll');
			return;
		}
		this.loginPollInFlight = true;
		try {
			const shouldRefreshImage = !this.loginImage || Date.now() - this.loginImageCapturedAt >= LOGIN_IMAGE_REFRESH_INTERVAL;
			const snapshot = await this.captureLoginSnapshot(this.loginPage, shouldRefreshImage, this.loginGeneration);
			this.emitLoginSnapshot(snapshot);
			if (!this.canContinueLogin(snapshot.status)) {
				this.stopLoginPolling();
			}
		} catch (error) {
			this.logger?.warn('Login polling stopped after page inspection failed: %s.', error instanceof Error ? error.name : 'unknown error');
			this.stopLoginPolling();
			this.publishTerminal({ status: 'page-error', message: '暂时无法读取官方登录页，已暂停登录。请检查网络或页面状态后手动重试。' }, 'login-poll');
		} finally {
			this.loginPollInFlight = false;
		}
	}

	private async captureLoginSnapshot(page: Page, includeImage: boolean, generation: number): Promise<LoginSnapshot> {
		if (generation !== this.loginGeneration || page !== this.loginPage) {
			return this.lastLoginSnapshot ?? this.toLoginSnapshot({ status: 'loading', message: '正在读取官方登录页面…' });
		}
		const initialUrl = page.url();
		const redirect = classifyOfficialErrorRedirect(initialUrl);
		if (redirect) {return this.publishOfficialPageError(redirect, 'login-inspection');}
		if (!this.isTrustedLoginPage(initialUrl)) {
			return this.publishTerminal({ status: 'page-error', message: '登录页跳转到了不受支持的地址，已停止读取。请检查官方页面后重新打开登录。' }, 'login-inspection');
		}
		let bodyText = '';
		let bodyReadOutcome: 'empty' | 'nonempty' | 'timeout' | 'failed' = 'empty';
		try {
			bodyText = await page.locator('body').innerText({ timeout: 1_500 });
			bodyReadOutcome = bodyText.trim() ? 'nonempty' : 'empty';
		} catch (error) {
			bodyReadOutcome = error instanceof Error && /timeout/i.test(error.name + error.message) ? 'timeout' : 'failed';
		}
		if (generation !== this.loginGeneration || page !== this.loginPage) {return this.toLoginSnapshot({ status: 'loading', message: '正在读取官方登录页面…' });}
		const afterReadError = classifyOfficialErrorRedirect(page.url());
		if (afterReadError) {return this.publishOfficialPageError(afterReadError, 'login-inspection');}
		const qrLocator = await this.findQrLocator(page);
		if (generation !== this.loginGeneration || page !== this.loginPage) {return this.toLoginSnapshot({ status: 'loading', message: '正在读取官方登录页面…' });}
		const finalUrl = page.url();
		const finalRedirect = classifyOfficialErrorRedirect(finalUrl);
		if (finalRedirect) {return this.publishOfficialPageError(finalRedirect, 'login-inspection');}
		if (!this.isTrustedLoginPage(finalUrl)) {
			return this.publishTerminal({ status: 'page-error', message: '登录页跳转到了不受支持的地址，已停止读取。请检查官方页面后重新打开登录。' }, 'login-inspection');
		}
		const detection = detectLoginState({
			url: finalUrl,
			bodyText,
			hasQr: Boolean(qrLocator),
			now: Date.now(),
			expiresAt: this.loginExpiresAt,
		});
		if (detection.status !== 'waiting-scan') {
			this.loginImage = undefined;
			this.loginImageCapturedAt = 0;
		} else if (includeImage) {
			const image = await this.captureQrImage(page, qrLocator);
			if (generation !== this.loginGeneration || page !== this.loginPage) {return this.toLoginSnapshot({ status: 'loading', message: '正在读取官方登录页面…' });}
			const afterScreenshotError = classifyOfficialErrorRedirect(page.url());
			if (afterScreenshotError) {return this.publishOfficialPageError(afterScreenshotError, 'login-inspection');}
			this.loginImage = image;
			if (image) {
				this.loginImageCapturedAt = Date.now();
				this.loginExpiresAt = this.loginImageCapturedAt + LOGIN_QR_LIFETIME;
			} else {
				this.loginImageCapturedAt = 0;
			}
		}
		if (detection.status === 'waiting-scan' && !this.loginImage) {
			return this.toLoginSnapshot({ status: 'loading', message: '正在读取官方登录二维码…' });
		}
		this.logger?.debug('Login page inspection completed (state: %s, body: %s).', detection.status, bodyReadOutcome);
		return this.toLoginSnapshot(detection);
	}

	private async waitForLoginSnapshot(page: Page, generation: number): Promise<LoginSnapshot> {
		const deadline = Date.now() + LOGIN_QR_WAIT_TIMEOUT;
		let snapshot = await this.captureLoginSnapshot(page, true, generation);
		while (Date.now() < deadline && snapshot.status === 'loading') {
			await new Promise(resolve => setTimeout(resolve, 500));
			snapshot = await this.captureLoginSnapshot(page, true, generation);
		}
		if (snapshot.status === 'loading') {
			this.logger?.info('Login QR was not available within %d ms.', LOGIN_QR_WAIT_TIMEOUT);
			return this.toLoginSnapshot({ status: 'qr-unavailable', message: '未能在规定时间内读取二维码，请刷新后重试。' });
		}
		return snapshot;
	}

	private handleLoginNavigation(page: Page, url: string): void {
		if (url === 'about:blank') {return;}
		const error = classifyOfficialErrorRedirect(url);
		if (error) {
			this.publishOfficialPageError(error, 'login-navigation');
			return;
		}
		if (!this.isTrustedLoginPage(url)) {
			this.publishTerminal({ status: 'page-error', message: '登录页跳转到了不受支持的地址，已停止读取。请检查官方页面后重新打开登录。' }, 'login-navigation');
		}
	}

	private publishOfficialPageError(error: OfficialPageError, operation: string): LoginSnapshot {
		this.logger?.warn('Official page redirect detected (operation: %s, kind: %s, code: %s).', operation, error.kind, error.platformCode ?? 'unknown');
		return this.publishTerminal({ status: error.kind === 'ip-risk' ? 'access-restricted' : 'page-error', message: error.message }, operation);
	}

	private publishTerminal(detection: LoginDetection, operation: string): LoginSnapshot {
		if (this.lastLoginSnapshot?.status === detection.status && this.lastLoginSnapshot.message === detection.message &&
			!this.lastLoginSnapshot.qrImage && this.lastLoginSnapshot.expiresAt === 0) {
			return this.lastLoginSnapshot;
		}
		this.stopLoginPolling();
		this.loginGeneration++;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		this.loginExpiresAt = 0;
		const snapshot = this.toLoginSnapshot(detection);
		this.logger?.info('Login attempt stopped (operation: %s, state: %s).', operation, detection.status);
		this.emitLoginSnapshot(snapshot);
		return snapshot;
	}

	private canContinueLogin(status: LoginStatus): boolean {
		return status === 'loading' || status === 'waiting-scan';
	}

	private async findQrLocator(page: Page): Promise<import('playwright').Locator | undefined> {
		const selectors = [
			'img.qrcode-img',
			'img[alt*="二维码"]',
			'img[src*="qrcode"]',
			'img[src*="qr"]',
			'[class*="qrcode"] img',
			'[class*="qr-code"] img',
			'[class*="qrcode"] canvas',
		];
		for (const selector of selectors) {
			const locator = page.locator(selector).first();
			if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {return locator;}
		}
		return undefined;
	}

	private isTrustedLoginPage(value: string): boolean {
		try {
			const url = new URL(value);
			return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'));
		} catch {
			return false;
		}
	}

	private async captureQrImage(page: Page, locator: import('playwright').Locator | undefined): Promise<string | undefined> {
		if (!locator) {return undefined;}
		try {
			const image = await locator.screenshot({ type: 'png', animations: 'disabled' });
			if (image.byteLength > LOGIN_IMAGE_LIMIT) {return undefined;}
			return image.toString('base64');
		} catch (error) {
			this.logger?.debug('QR screenshot unavailable: %s.', error instanceof Error ? error.name : 'unknown error');
			return undefined;
		}
	}

	private toLoginSnapshot(detection: LoginDetection): LoginSnapshot {
		return {
			status: detection.status,
			message: detection.message,
			qrImage: this.loginImage,
			expiresAt: this.loginExpiresAt,
		};
	}

	private emitLoginSnapshot(snapshot: LoginSnapshot): void {
		if (this.lastLoginSnapshot && this.lastLoginSnapshot.status === snapshot.status &&
			this.lastLoginSnapshot.message === snapshot.message && this.lastLoginSnapshot.qrImage === snapshot.qrImage &&
			this.lastLoginSnapshot.expiresAt === snapshot.expiresAt) {return;}
		this.lastLoginSnapshot = snapshot;
		for (const listener of this.loginListeners) {listener(snapshot);}
	}

	private async launchContext(): Promise<BrowserContext> {
		this.logger?.info('Launching persistent %s Chromium browser.', this.mode);
		try {
			await mkdir(this.profilePath, { recursive: true });
			// Playwright selects a different executable for headless mode. Let it validate
			// that runtime instead of checking chromium.executablePath() (the headed binary).
			return await chromium.launchPersistentContext(this.profilePath, { headless: this.mode === 'headless' });
		} catch (error) {
			const failure = diagnoseBrowserStartup(error, this.mode);
			this.logger?.error('Chromium launch failed (mode: %s, platform: %s, category: %s, missing libraries: %s).',
				this.mode, process.platform, failure.category, failure.missingLibraries.join(', ') || 'none detected');
			throw failure.error;
		}
	}

	private async closeContext(): Promise<void> {
		const context = this.context;
		this.context = undefined;
		this.loginPage = undefined;
		if (context) {
			this.logger?.debug('Closing persistent Chromium browser.');
			await context.close().catch(() => undefined);
		}
	}
}
