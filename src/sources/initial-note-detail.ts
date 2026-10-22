import type { Page } from 'playwright';
import { SourceError } from '../models/source-error';

/** Reads only the requested note from the official page's server-rendered state. */
export async function readInitialNoteDetail(
	page: Page,
	id: string,
	limit: number,
): Promise<unknown | undefined> {
	const serialized = await page.evaluate(
		({ noteId, maxLength }) => {
			if (
				location.origin !== 'https://www.xiaohongshu.com' ||
				location.pathname !== `/explore/${encodeURIComponent(noteId)}`
			) {
				return undefined;
			}
			const asRecord = (value: unknown): Record<string, unknown> | undefined =>
				typeof value === 'object' && value !== null && !Array.isArray(value)
					? (value as Record<string, unknown>)
					: undefined;
			// Hydration can wrap the map in a Vue ref. Read its public value rather
			// than serializing reactive internals or the surrounding account state.
			const unwrap = (value: unknown): unknown => {
				const ref = asRecord(value);
				return ref?.__v_isRef === true ? ref.value : value;
			};
			const state = (window as unknown as { __INITIAL_STATE__?: { note?: unknown } })
				.__INITIAL_STATE__;
			const notes = asRecord(unwrap(state?.note));
			const map = asRecord(unwrap(notes?.noteDetailMap));
			const entry = asRecord(unwrap(map?.[noteId]));
			const note = asRecord(unwrap(entry?.note));
			const identity = note?.noteId ?? note?.note_id ?? note?.id;
			// Empty placeholders and other notes must not win the race against the
			// detail API. An empty description is valid for an image-only note.
			if (identity !== noteId || typeof note?.desc !== 'string') {
				return undefined;
			}
			const json = JSON.stringify({ data: { items: [{ note_card: note }] } });
			return json.length <= maxLength ? json : null;
		},
		{ noteId: id, maxLength: limit },
	);
	if (serialized === undefined) {
		return undefined;
	}
	if (serialized === null || Buffer.byteLength(serialized, 'utf8') > limit) {
		throw new SourceError('parse-failure', '页面笔记数据超过允许的读取大小。', false);
	}
	return JSON.parse(serialized) as unknown;
}
