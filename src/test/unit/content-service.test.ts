import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContentApplicationService } from '../../application/content-service';
import type { FeedItem, PageResult } from '../../models/content';
import { SourceError } from '../../models/source-error';
import { FakeContentSource } from '../../sources/fake-content-source';
import type { ContentSource } from '../../sources/content-source';

const item = (id: string): FeedItem => ({
	id,
	title: id,
	mediaType: 'unknown',
	noteUrl: `https://www.xiaohongshu.com/explore/${id}`,
});

function makeSource(overrides: Partial<ContentSource> = {}): ContentSource {
	const base = new FakeContentSource();
	return {
		getHomeFeed: (...args) => overrides.getHomeFeed?.(...args) ?? base.getHomeFeed(...args),
		getExploreFeed: (...args) => overrides.getExploreFeed?.(...args) ?? base.getExploreFeed(...args),
	searchNotes: (...args) => overrides.searchNotes?.(...args) ?? base.searchNotes(...args),
		getNoteDetail: (...args) => overrides.getNoteDetail?.(...args) ?? base.getNoteDetail(...args),
		getSessionStatus: () => overrides.getSessionStatus?.() ?? base.getSessionStatus(),
		openLogin: () => overrides.openLogin?.() ?? base.openLogin(),
		dispose: () => overrides.dispose?.() ?? base.dispose(),
	};
}

test('loads first page and merges subsequent pages without duplicate IDs', async () => {
	const source = makeSource({
		getHomeFeed: async (cursor?: string): Promise<PageResult<FeedItem>> => cursor
			? { items: [item('note-1'), item('note-2')] }
			: { items: [item('note-1')], nextCursor: 'next' },
	});
	const service = new ContentApplicationService(source);

	await service.refreshHomeFeed();
	assert.deepStrictEqual(service.getState('home').items.map(note => note.id), ['note-1']);
	assert.equal(service.getState('home').nextCursor, 'next');

	await service.loadMore('home');
	assert.deepStrictEqual(service.getState('home').items.map(note => note.id), ['note-1', 'note-2']);
	assert.equal(service.getState('home').nextCursor, undefined);
});

test('keeps previously loaded items when refresh fails', async () => {
	let fail = false;
	const source = makeSource({
		getHomeFeed: async () => {
			if (fail) {
				throw new SourceError('network', 'Network unavailable', true);
			}
			return { items: [item('note-1')] };
		},
	});
	const service = new ContentApplicationService(source);

	await service.refreshHomeFeed();
	fail = true;
	await service.refreshHomeFeed();

	assert.deepStrictEqual(service.getState('home').items.map(note => note.id), ['note-1']);
	assert.equal(service.getState('home').error?.code, 'network');
});

test('rejects blank searches without replacing the active result state', async () => {
	const service = new ContentApplicationService(new FakeContentSource());
	await service.searchNotes('阅读');
	const existing = service.getState('search');

	await assert.rejects(service.searchNotes('  '), { code: 'invalid-query' });
	assert.deepStrictEqual(service.getState('search').items, existing.items);
	assert.equal(service.getState('search').query, '阅读');
});

test('ignores a cancelled search response after a newer query starts', async () => {
	let resolveOld: ((page: PageResult<FeedItem>) => void) | undefined;
	const source = makeSource({
		searchNotes: (query: string) => query === 'old'
			? new Promise(resolve => { resolveOld = resolve; })
			: Promise.resolve({ items: [item('new-result')] }),
	});
	const service = new ContentApplicationService(source);
	const oldSearch = service.searchNotes('old');
	const newSearch = service.searchNotes('new');
	resolveOld?.({ items: [item('stale-result')] });
	await Promise.all([oldSearch, newSearch]);

	assert.deepStrictEqual(service.getState('search').items.map(note => note.id), ['new-result']);
	assert.equal(service.getState('search').query, 'new');
});
