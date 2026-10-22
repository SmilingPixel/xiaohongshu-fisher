import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Page, Response } from 'playwright';
import type { BrowserSession } from '../../session/browser-session';
import { XiaohongshuPageSource } from '../../sources/xiaohongshu-page-source';

test('captures v2 search results for both the first page and pagination', async (context) => {
	let pageIndex = 0;
	const events = new EventEmitter();
	const emitResponse = (): void => {
		pageIndex += 1;
		const response = {
			url: () => 'https://edith.xiaohongshu.com/api/sns/web/v2/search/notes',
			status: () => 200,
			headers: () => ({}),
			json: async () => ({
				success: true,
				data: {
					items: [{ id: `note-${pageIndex}`, note_card: { display_title: 'Search fixture' } }],
					has_more: pageIndex === 1,
				},
			}),
		} as unknown as Response;
		events.emit('response', response);
	};
	const page = Object.assign(events, {
		goto: async () => emitResponse(),
		evaluate: async () => emitResponse(),
		close: async () => {
			events.emit('close');
		},
	}) as unknown as Page;
	const session = {
		openPage: async () => page,
		dispose: async () => undefined,
	} as unknown as BrowserSession;
	const source = new XiaohongshuPageSource(session);
	context.after(() => source.dispose());
	const signal = AbortSignal.timeout(1_000);

	const first = await source.searchNotes('fixture', undefined, signal);
	assert.equal(first.items[0]?.id, 'note-1');
	assert.equal(first.nextCursor, '1');

	const next = await source.searchNotes('fixture', first.nextCursor, signal);
	assert.equal(next.items[0]?.id, 'note-2');
	assert.equal(next.nextCursor, undefined);
	assert.deepEqual(events.eventNames(), []);
});

const detailPayload = {
	data: { items: [{ note_card: { noteId: 'detail-fixture', desc: 'Detail fixture body' } }] },
};

function detailResponse(status = 200): Response {
	return {
		url: () => 'https://edith.xiaohongshu.com/api/sns/web/v1/feed',
		status: () => status,
		headers: () => ({}),
		json: async () => detailPayload,
	} as unknown as Response;
}

function detailSource(
	options: {
		navigate?: (events: EventEmitter) => Promise<void>;
		readInitial?: (events: EventEmitter) => Promise<string | undefined>;
	} = {},
): { source: XiaohongshuPageSource; events: EventEmitter; isClosed: () => boolean } {
	const events = new EventEmitter();
	let closed = false;
	const page = Object.assign(events, {
		goto: async () => options.navigate?.(events),
		evaluate: async () => options.readInitial?.(events),
		close: async () => {
			closed = true;
			events.emit('close');
		},
	}) as unknown as Page;
	const session = {
		openPage: async () => page,
		dispose: async () => undefined,
	} as unknown as BrowserSession;
	return { source: new XiaohongshuPageSource(session), events, isClosed: () => closed };
}

test('loads initial note detail without an API response and cleans up the capture', async (context) => {
	const { source, events, isClosed } = detailSource({
		readInitial: async () => JSON.stringify(detailPayload),
	});
	context.after(() => source.dispose());
	const detail = await source.getNoteDetail('detail-fixture', undefined, AbortSignal.timeout(1000));
	assert.equal(detail.body, 'Detail fixture body');
	assert.equal(isClosed(), true);
	assert.deepEqual(events.eventNames(), []);
});

test('keeps waiting for the detail API when initial state is unavailable', async (context) => {
	const { source, events, isClosed } = detailSource({
		readInitial: async (events) => {
			setImmediate(() => events.emit('response', detailResponse()));
			return undefined;
		},
	});
	context.after(() => source.dispose());
	const detail = await source.getNoteDetail('detail-fixture', undefined, AbortSignal.timeout(1000));
	assert.equal(detail.id, 'detail-fixture');
	assert.equal(isClosed(), true);
	assert.deepEqual(events.eventNames(), []);
});

test('cancellation takes precedence over an in-flight initial note read', async (context) => {
	const controller = new AbortController();
	const { source, events, isClosed } = detailSource({
		readInitial: async () => {
			controller.abort();
			return JSON.stringify(detailPayload);
		},
	});
	context.after(() => source.dispose());
	await assert.rejects(source.getNoteDetail('detail-fixture', undefined, controller.signal), {
		code: 'unknown',
		message: '请求已取消。',
	});
	assert.equal(isClosed(), true);
	assert.deepEqual(events.eventNames(), []);
});

test('restricted detail API responses reject without falling back to initial state', async (context) => {
	const { source, events, isClosed } = detailSource({
		navigate: async (events) => {
			events.emit('response', detailResponse(403));
		},
		readInitial: async () => JSON.stringify(detailPayload),
	});
	context.after(() => source.dispose());
	await assert.rejects(
		source.getNoteDetail('detail-fixture', undefined, AbortSignal.timeout(1000)),
		{ code: 'access-restricted' },
	);
	assert.equal(isClosed(), true);
	assert.deepEqual(events.eventNames(), []);
});

test('preserves platform token sources and infers missing sources from their feed', async (context) => {
	for (const [feed, explicitSource, expectedSource] of [
		['home', undefined, 'pc_feed'],
		['search', undefined, 'pc_search'],
		['search', 'fixture-platform-source', 'fixture-platform-source'],
	] as const) {
		let detailUrl: URL | undefined;
		const session = {
			openPage: async () => {
				const events = new EventEmitter();
				return Object.assign(events, {
					goto: async (value: string) => {
						const url = new URL(value);
						if (url.pathname === '/explore/detail-fixture') {
							detailUrl = url;
							events.emit('response', detailResponse());
							return;
						}
						events.emit('response', {
							url: () =>
								`https://edith.xiaohongshu.com/api/sns/web/${feed === 'search' ? 'v2/search/notes' : 'v1/homefeed'}`,
							status: () => 200,
							headers: () => ({}),
							json: async () => ({
								data: {
									items: [
										{
											id: 'detail-fixture',
											xsec_token: 'fixture-token-only',
											xsec_source: explicitSource,
											note_card: { title: 'Fixture card' },
										},
									],
									has_more: false,
								},
							}),
						});
					},
					evaluate: async () => undefined,
					close: async () => {
						events.emit('close');
					},
				});
			},
			dispose: async () => undefined,
		} as unknown as BrowserSession;
		const source = new XiaohongshuPageSource(session);
		context.after(() => source.dispose());
		const signal = AbortSignal.timeout(1000);
		if (feed === 'search') {
			await source.searchNotes('fixture', undefined, signal);
		} else {
			await source.getHomeFeed(undefined, signal);
		}
		const detail = await source.getNoteDetail('detail-fixture', { source: 'external' }, signal);
		assert.equal(detailUrl?.searchParams.get('xsec_token'), 'fixture-token-only');
		assert.equal(detailUrl?.searchParams.get('xsec_source'), expectedSource);
		assert.doesNotMatch(JSON.stringify(detail), /fixture-token-only|xsec_/);
	}
});
