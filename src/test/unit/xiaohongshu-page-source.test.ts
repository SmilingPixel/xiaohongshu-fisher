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
