import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { Page } from 'playwright';
import { readInitialNoteDetail } from '../../sources/initial-note-detail';
import { normalizeNoteDetail } from '../../sources/normalize';

const noteId = 'fixture-note';
const noteUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
const note = {
	noteId,
	title: 'Initial note fixture',
	desc: 'Fixture body',
	imageList: [{ urlDefault: 'https://sns-img.xhscdn.com/image.jpg' }],
	user: { userId: 'fixture-author', nickName: 'Fixture author' },
};

function initialPage(state: unknown, url = noteUrl): Page {
	return {
		// Execute the actual browser callback in an isolated context with synthetic data.
		evaluate: async (callback: (...args: never[]) => unknown, args: unknown) =>
			runInNewContext(`(${callback.toString()})(args)`, {
				window: { __INITIAL_STATE__: state },
				location: new URL(url),
				args,
			}),
	} as unknown as Page;
}

test('extracts only the requested note before and after hydration', async () => {
	for (const hydrated of [false, true]) {
		const desc = hydrated ? '' : note.desc;
		const map = {
			[noteId]: { note: { ...note, desc } },
			other: { note: { desc: 'unrelated-note' } },
		};
		const page = initialPage({
			note: { noteDetailMap: hydrated ? { __v_isRef: true, value: map } : map },
			user: { privateField: 'unrelated-account-state' },
		});
		const payload = await readInitialNoteDetail(page, noteId, 4096);
		const detail = normalizeNoteDetail(payload);
		assert.equal(detail.id, noteId);
		assert.equal(detail.body, desc);
		assert.equal(detail.author?.name, 'Fixture author');
		assert.deepEqual(detail.media, [
			{ type: 'image', url: 'https://sns-img.xhscdn.com/image.jpg' },
		]);
		assert.doesNotMatch(JSON.stringify(payload), /unrelated-note|unrelated-account-state/);
	}
});

test('ignores unavailable details, mismatched notes, and untrusted routes', async () => {
	const state = { note: { noteDetailMap: { [noteId]: { note } } } };
	for (const page of [
		initialPage(undefined),
		initialPage({ note: { noteDetailMap: { [noteId]: { note: { noteId } } } } }),
		initialPage({ note: { noteDetailMap: { [noteId]: { note: { ...note, noteId: 'other' } } } } }),
		initialPage(state, `http://www.xiaohongshu.com/explore/${noteId}`),
		initialPage(state, `https://www.xiaohongshu.com.evil.test/explore/${noteId}`),
		initialPage(state, 'https://www.xiaohongshu.com/explore/other'),
	]) {
		assert.equal(await readInitialNoteDetail(page, noteId, 4096), undefined);
	}
});

test('enforces both serialized character and UTF-8 byte limits', async () => {
	for (const desc of ['a'.repeat(4096), '图'.repeat(1500)]) {
		const page = initialPage({
			note: { noteDetailMap: { [noteId]: { note: { ...note, desc } } } },
		});
		await assert.rejects(readInitialNoteDetail(page, noteId, 4096), { code: 'parse-failure' });
	}
});
