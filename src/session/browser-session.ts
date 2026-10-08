import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import * as vscode from 'vscode';
import { SourceError } from '../models/source-error';
import { browserModeLabel, resolveBrowserMode, type BrowserMode, type ResolvedBrowserMode } from './browser-mode';
import { detectLoginState, type LoginDetection, type LoginStatus } from './login-state';

const HOME_URL = 'https://www.xiaohongshu.com/';
const PROFILE_DIRECTORY = 'browser-profile';
const LOGIN_POLL_INTERVAL = 2_000;
const LOGIN_IMAGE_REFRESH_INTERVAL = 10_000;
const LOGIN_QR_LIFETIME = 2 * 60 * 1_000;
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

	constructor(storageUri: vscode.Uri, configuredMode: BrowserMode = 'auto') {
		this.profilePath = path.join(storageUri.fsPath, PROFILE_DIRECTORY);
		this.mode = resolveBrowserMode(configuredMode, {
			display: process.env.DISPLAY,
			waylandDisplay: process.env.WAYLAND_DISPLAY,
			remote: Boolean(vscode.env.remoteName),
			platform: process.platform,
		});
	}

	static hasBrowserRuntime(): boolean {
		return existsSync(chromium.executablePath());
	}

	getMode(): ResolvedBrowserMode {
		return this.mode;
	}

	onLoginSnapshot(listener: LoginSnapshotListener): vscode.Disposable {
		this.loginListeners.add(listener);
		return { dispose: () => this.loginListeners.delete(listener) };
	}

	async openLogin(): Promise<void> {
		const context = await this.getContext();
		const page = await this.getLoginPage(context);
		this.stopLoginPolling();
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
		await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
		this.loginExpiresAt = Date.now() + LOGIN_QR_LIFETIME;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		this.lastLoginSnapshot = undefined;
		const snapshot = await this.captureLoginSnapshot(page, true);
		this.emitLoginSnapshot(snapshot);
		this.startLoginPolling();
		return snapshot;
	}

	async refreshHeadlessLoginQr(): Promise<LoginSnapshot> {
		if (this.mode !== 'headless') {
			throw new SourceError('browser-startup', '当前浏览器模式不是无头模式。', false);
		}
		const page = await this.getLoginPage(await this.getContext());
		this.stopLoginPolling();
		this.loginExpiresAt = Date.now() + LOGIN_QR_LIFETIME;
		this.loginImage = undefined;
		this.loginImageCapturedAt = 0;
		await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
		const snapshot = await this.captureLoginSnapshot(page, true);
		this.emitLoginSnapshot(snapshot);
		this.startLoginPolling();
		return snapshot;
	}

	stopLogin(): void {
		this.stopLoginPolling();
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
		this.stopLogin();
		await this.closeContext();
		await rm(this.profilePath, { recursive: true, force: true });
	}

	async dispose(): Promise<void> {
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
		if (Date.now() >= this.loginExpiresAt) {
			this.stopLoginPolling();
			this.loginImage = undefined;
			this.loginImageCapturedAt = 0;
			const detection: LoginDetection = { status: 'expired', message: '二维码已过期，请刷新二维码后重试。' };
			this.emitLoginSnapshot(this.toLoginSnapshot(detection));
			return;
		}
		this.loginPollInFlight = true;
		try {
			const shouldRefreshImage = !this.loginImage || Date.now() - this.loginImageCapturedAt >= LOGIN_IMAGE_REFRESH_INTERVAL;
			const snapshot = await this.captureLoginSnapshot(this.loginPage, shouldRefreshImage);
			this.emitLoginSnapshot(snapshot);
			if (snapshot.status === 'logged-in' || snapshot.status === 'verification-required' || snapshot.status === 'expired') {
				this.stopLoginPolling();
			}
		} catch {
			this.stopLoginPolling();
			this.emitLoginSnapshot({
				status: 'verification-required',
				message: '无法继续检查官方登录页，请关闭此窗口并重新打开登录。',
				expiresAt: this.loginExpiresAt,
			});
		} finally {
			this.loginPollInFlight = false;
		}
	}

	private async captureLoginSnapshot(page: Page, includeImage: boolean): Promise<LoginSnapshot> {
		if (!this.isTrustedLoginPage(page.url())) {
			return this.toLoginSnapshot({
				status: 'verification-required',
				message: '官方登录页跳转到了不受支持的域名，已停止二维码读取。',
			});
		}
		let bodyText = '';
		try {bodyText = await page.locator('body').innerText({ timeout: 1_500 });} catch { /* page may still be loading */ }
		const qrLocator = await this.findQrLocator(page);
		const detection = detectLoginState({
			url: page.url(),
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
			this.loginImage = image;
			this.loginImageCapturedAt = Date.now();
		}
		return this.toLoginSnapshot(detection);
	}

	private async findQrLocator(page: Page): Promise<import('playwright').Locator | undefined> {
		const selectors = [
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
			return url.protocol === 'https:' && (url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'));
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
		} catch {
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
		await mkdir(this.profilePath, { recursive: true });
		if (!existsSync(chromium.executablePath())) {
			throw new SourceError('browser-missing', '未安装 Playwright Chromium，请先运行“安装浏览器运行时”。', false);
		}
		try {
			return await chromium.launchPersistentContext(this.profilePath, { headless: this.mode === 'headless' });
		} catch (error) {
			const reason = error instanceof Error ? error.message : undefined;
			const environmentHint = this.mode === 'visible'
				? '请检查 DISPLAY/Wayland 桌面环境；无图形环境可将 browserMode 设置为 headless。'
				: '请检查 Chromium 系统依赖和沙箱权限。';
			const detail = reason?.toLowerCase().includes('display') ? '当前环境没有可用的图形显示。' : environmentHint;
			throw new SourceError('browser-startup', `无法启动${browserModeLabel(this.mode)} Chromium。${detail}`, false);
		}
	}

	private async closeContext(): Promise<void> {
		const context = this.context;
		this.context = undefined;
		this.loginPage = undefined;
		if (context) {await context.close().catch(() => undefined);}
	}
}
