import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import * as vscode from 'vscode';
import { SourceError } from '../models/source-error';

const HOME_URL = 'https://www.xiaohongshu.com/';
const PROFILE_DIRECTORY = 'browser-profile';

export class BrowserSession implements vscode.Disposable {
	private context?: BrowserContext;
	private opening?: Promise<BrowserContext>;
	private loginPage?: Page;
	private readonly profilePath: string;

	constructor(storageUri: vscode.Uri) {
		this.profilePath = path.join(storageUri.fsPath, PROFILE_DIRECTORY);
	}

	static hasBrowserRuntime(): boolean {
		return existsSync(chromium.executablePath());
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
			return await chromium.launchPersistentContext(this.profilePath, { headless: false });
		} catch {
			throw new SourceError('browser-missing', '无法启动独立浏览器，请检查桌面环境和浏览器安装状态。', false);
		}
	}

	private async closeContext(): Promise<void> {
		const context = this.context;
		this.context = undefined;
		this.loginPage = undefined;
		if (context) {await context.close().catch(() => undefined);}
	}
}
