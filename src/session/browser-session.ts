import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import * as vscode from 'vscode';
import { SourceError } from '../models/source-error';
import { browserModeLabel, resolveBrowserMode, type BrowserMode, type ResolvedBrowserMode } from './browser-mode';

const HOME_URL = 'https://www.xiaohongshu.com/';
const PROFILE_DIRECTORY = 'browser-profile';

export class BrowserSession implements vscode.Disposable {
	private context?: BrowserContext;
	private opening?: Promise<BrowserContext>;
	private loginPage?: Page;
	private readonly profilePath: string;
	private readonly mode: ResolvedBrowserMode;

	constructor(storageUri: vscode.Uri, configuredMode: BrowserMode = 'auto') {
		this.profilePath = path.join(storageUri.fsPath, PROFILE_DIRECTORY);
		this.mode = resolveBrowserMode(configuredMode, {
			display: process.env.DISPLAY,
			waylandDisplay: process.env.WAYLAND_DISPLAY,
		});
	}

	static hasBrowserRuntime(): boolean {
		return existsSync(chromium.executablePath());
	}

	getMode(): ResolvedBrowserMode {
		return this.mode;
	}

	async openLogin(): Promise<void> {
		const context = await this.getContext();
		if (!this.loginPage || this.loginPage.isClosed()) {
			this.loginPage = await context.newPage();
		}
		await this.loginPage.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
		await this.loginPage.bringToFront();
	}

	async openPage(): Promise<Page> {
		return (await this.getContext()).newPage();
	}

	async clear(): Promise<void> {
		await this.closeContext();
		await rm(this.profilePath, { recursive: true, force: true });
	}

	async dispose(): Promise<void> {
		await this.closeContext();
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
