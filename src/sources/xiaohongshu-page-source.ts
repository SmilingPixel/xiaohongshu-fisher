import type { BrowserSession } from '../session/browser-session';
import type { FeedItem, NoteDetail, NoteSourceContext, PageResult, SessionStatus } from '../models/content';
import { SourceError } from '../models/source-error';
import { getNoteToken, normalizeNoteDetail, normalizePageResponse } from './normalize';
import type { ContentSource } from './content-source';
import type { Page, Response } from 'playwright';

const SITE_ORIGIN = 'https://www.xiaohongshu.com';
const HOME_FEED_PATH = '/api/sns/web/v1/homefeed';
const SEARCH_PATH = '/api/sns/web/v1/search/notes';
const DETAIL_PATH = '/api/sns/web/v1/feed';
const RESPONSE_LIMIT = 5 * 1024 * 1024;
const RESPONSE_TIMEOUT = 20_000;

interface Stream {
	page: Page;
	nextIndex: number;
	closed: boolean;
}

export class XiaohongshuPageSource implements ContentSource {
	private readonly streams = new Map<string, Stream>();
	private readonly noteTokens = new Map<string, { token: string; source?: string }>();
	private currentSearchKey?: string;

	constructor(private readonly session: BrowserSession) {}

	getHomeFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>> {
		return this.loadStream('home', `${SITE_ORIGIN}/`, HOME_FEED_PATH, cursor, signal);
	}

	getExploreFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>> {
		return this.loadStream('explore', `${SITE_ORIGIN}/explore`, HOME_FEED_PATH, cursor, signal);
	}

	searchNotes(query: string, cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>> {
		const key = `search:${query}`;
		if (this.currentSearchKey && this.currentSearchKey !== key) {
			void this.closeStream(this.currentSearchKey);
		}
		this.currentSearchKey = key;
		const url = `${SITE_ORIGIN}/search_result?keyword=${encodeURIComponent(query)}`;
		return this.loadStream(key, url, SEARCH_PATH, cursor, signal);
	}

	async getNoteDetail(id: string, context?: NoteSourceContext, signal?: AbortSignal): Promise<NoteDetail> {
		const url = this.getDetailUrl(id, context);
		const page = await this.session.openPage();
		try {
			const payload = await this.navigateAndCapture(page, url, DETAIL_PATH, signal);
			return normalizeNoteDetail(payload);
		} finally {
			await page.close().catch(() => undefined);
		}
	}

	async getSessionStatus(): Promise<SessionStatus> {
		return 'unknown';
	}

	openLogin(): Promise<void> {
		return this.session.openLogin();
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.streams.keys()].map(key => this.closeStream(key)));
		this.noteTokens.clear();
		await this.session.dispose();
	}

	private async loadStream(
		key: string,
		url: string,
		path: string,
		cursor?: string,
		signal?: AbortSignal
	): Promise<PageResult<FeedItem>> {
		if (signal?.aborted) {throw new SourceError('unknown', '请求已取消。', false);}
		if (cursor === undefined) {
			await this.closeStream(key);
			const page = await this.session.openPage();
			const stream: Stream = { page, nextIndex: 0, closed: false };
			this.streams.set(key, stream);
			try {
				const payload = await this.navigateAndCapture(page, url, path, signal);
				return this.toPageResult(key, stream, payload);
			} catch (error) {
				await this.closeStream(key);
				throw error;
			}
		}

		const stream = this.streams.get(key);
		if (!stream || stream.closed || cursor !== String(stream.nextIndex)) {
			throw new SourceError('parse-failure', '当前页面分页状态已失效，请刷新列表。', false);
		}
		try {
			const payload = await this.captureAfterScroll(stream.page, path, signal);
			return this.toPageResult(key, stream, payload);
		} catch (error) {
			await this.closeStream(key);
			throw error;
		}
	}

	private async navigateAndCapture(page: Page, url: string, path: string, signal?: AbortSignal): Promise<unknown> {
		const responsePromise = this.waitForApiResponse(page, path);
		const abort = () => { void page.close().catch(() => undefined); };
		signal?.addEventListener('abort', abort, { once: true });
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RESPONSE_TIMEOUT });
			return await this.readResponse(await responsePromise);
		} catch (error) {
			if (signal?.aborted) {throw new SourceError('unknown', '请求已取消。', false);}
			if (error instanceof SourceError) {throw error;}
			throw new SourceError('network', '无法从当前页面读取内容，请检查网络或登录状态。', true);
		} finally {
			signal?.removeEventListener('abort', abort);
		}
	}

	private async captureAfterScroll(page: Page, path: string, signal?: AbortSignal): Promise<unknown> {
		const responsePromise = this.waitForApiResponse(page, path);
		const abort = () => { void page.close().catch(() => undefined); };
		signal?.addEventListener('abort', abort, { once: true });
		try {
			await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
			return await this.readResponse(await responsePromise);
		} catch (error) {
			if (signal?.aborted) {throw new SourceError('unknown', '请求已取消。', false);}
			if (error instanceof SourceError) {throw error;}
			throw new SourceError('network', '页面没有返回下一页内容，请稍后重试。', true);
		} finally {
			signal?.removeEventListener('abort', abort);
		}
	}

	private waitForApiResponse(page: Page, path: string): Promise<Response> {
		return page.waitForResponse(response => {
			try {
				const url = new URL(response.url());
				return this.isAllowedHost(url.hostname) && url.pathname === path;
			} catch {
				return false;
			}
		}, { timeout: RESPONSE_TIMEOUT });
	}

	private async readResponse(response: Response): Promise<unknown> {
		if (!this.isAllowedHost(new URL(response.url()).hostname)) {
			throw new SourceError('access-restricted', '页面返回了非官方域名的数据。', false);
		}
		if (response.status() === 401 || response.status() === 403 || response.status() === 429 || response.status() === 461 || response.status() === 471) {
			throw new SourceError('access-restricted', '小红书暂时限制了此页面访问，请在官方页面处理后再试。', false);
		}
		const contentLength = Number(response.headers()['content-length'] ?? 0);
		if (contentLength > RESPONSE_LIMIT) {
			throw new SourceError('parse-failure', '页面响应超过允许的读取大小。', false);
		}
		try {
			const payload: unknown = await response.json();
			const root = payload as { success?: unknown; code?: unknown; data?: unknown };
			if (root?.success === false || (root?.code !== undefined && String(root.code) !== '0')) {
				throw new SourceError('access-restricted', '小红书未提供此页面内容，请检查登录状态或稍后再试。', false);
			}
			return payload;
		} catch (error) {
			if (error instanceof SourceError) {throw error;}
			throw new SourceError('parse-failure', '页面响应格式暂时无法读取。', false);
		}
	}

	private toPageResult(key: string, stream: Stream, payload: unknown): PageResult<FeedItem> {
		const normalized = normalizePageResponse(payload);
		for (const raw of this.getRawItems(payload)) {
			const item = normalized.items.find(entry => entry.id === this.getRawId(raw));
			const token = getNoteToken(raw);
			if (item && token.token) {this.noteTokens.set(item.id, { token: token.token, source: token.source });}
		}
		stream.nextIndex += 1;
		return {
			items: normalized.items,
			nextCursor: normalized.hasMore ? String(stream.nextIndex) : undefined,
		};
	}

	private getDetailUrl(id: string, context?: NoteSourceContext): string {
		const url = new URL(`/explore/${encodeURIComponent(id)}`, SITE_ORIGIN);
		const tokenInfo = this.noteTokens.get(id);
		if (tokenInfo?.token) {
			url.searchParams.set('xsec_token', tokenInfo.token);
			url.searchParams.set('xsec_source', tokenInfo.source ?? context?.source ?? 'pc_feed');
		}
		return url.toString();
	}

	private isAllowedHost(hostname: string): boolean {
		return hostname === 'xiaohongshu.com' || hostname.endsWith('.xiaohongshu.com');
	}

	private getRawItems(value: unknown): unknown[] {
		const root = value as { data?: { items?: unknown[] } };
		return Array.isArray(root?.data?.items) ? root.data.items : [];
	}

	private getRawId(value: unknown): string | undefined {
		const raw = value as { note_card?: { note_id?: unknown }; note_id?: unknown };
		const noteId = raw?.note_card?.note_id ?? raw?.note_id;
		return typeof noteId === 'string' ? noteId : undefined;
	}

	private async closeStream(key: string): Promise<void> {
		const stream = this.streams.get(key);
		if (!stream) {return;}
		this.streams.delete(key);
		stream.closed = true;
		await stream.page.close().catch(() => undefined);
	}
}
