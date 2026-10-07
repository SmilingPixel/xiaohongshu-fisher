import type { FeedItem, NoteDetail, NoteSourceContext, PageResult, SessionStatus } from '../models/content';
import type { ContentSource } from './content-source';

const fixtures: FeedItem[] = [
	{
		id: 'fixture-note-01',
		title: '示例笔记：一周阅读清单',
		excerpt: '仅用于本地界面开发的虚构内容。',
		author: { id: 'fixture-author-01', name: '示例作者' },
		mediaType: 'image',
		noteUrl: 'https://www.xiaohongshu.com/explore/fixture-note-01',
		stats: { likes: 128, comments: 8 },
	},
	{
		id: 'fixture-note-02',
		title: '示例笔记：整理工作台',
		excerpt: '第二条虚构笔记，用于验证列表密度。',
		author: { id: 'fixture-author-02', name: '本地样例' },
		mediaType: 'mixed',
		noteUrl: 'https://www.xiaohongshu.com/explore/fixture-note-02',
	},
	{
		id: 'fixture-note-03',
		title: '示例笔记：城市散步路线',
		author: { id: 'fixture-author-03', name: '测试用户' },
		mediaType: 'video',
		noteUrl: 'https://www.xiaohongshu.com/explore/fixture-note-03',
	},
];

export class FakeContentSource implements ContentSource {
	async getHomeFeed(cursor?: string, _signal?: AbortSignal): Promise<PageResult<FeedItem>> {
		return this.page(cursor);
	}

	async getExploreFeed(cursor?: string, _signal?: AbortSignal): Promise<PageResult<FeedItem>> {
		return this.page(cursor);
	}

	async searchNotes(query: string, cursor?: string, _signal?: AbortSignal): Promise<PageResult<FeedItem>> {
		const matches = fixtures.filter(item => `${item.title} ${item.excerpt ?? ''}`.includes(query));
		return this.page(cursor, matches);
	}

	async getNoteDetail(id: string, _context?: NoteSourceContext, _signal?: AbortSignal): Promise<NoteDetail> {
		const item = fixtures.find(fixture => fixture.id === id);
		if (!item) {
			throw Object.assign(new Error('Fixture note was not found'), { name: 'NotFoundError' });
		}
		return { ...item, body: item.excerpt ?? '', media: [], topics: [] };
	}

	async getSessionStatus(): Promise<SessionStatus> {
		return 'logged-out';
	}

	async openLogin(): Promise<void> {}

	async dispose(): Promise<void> {}

	private page(cursor?: string, items = fixtures): PageResult<FeedItem> {
		const offset = Number(cursor ?? 0);
		const pageItems = items.slice(offset, offset + 2);
		const nextOffset = offset + pageItems.length;
		return {
			items: pageItems,
			nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
		};
	}
}
