import type { Page } from 'playwright';
import { SourceError } from '../models/source-error';

/** A scroll before hydration can be lost because the official handlers are not attached yet. */
export async function waitForHomeFeedReady(page: Page, timeout: number): Promise<void> {
	const ready = await page.waitForFunction(
		() => {
			const state = (
				window as unknown as {
					__INITIAL_STATE__?: { feed?: { feeds?: unknown; isFetching?: unknown } };
				}
			).__INITIAL_STATE__;
			// The server array becomes a Vue ref when the page takes over pagination.
			// Pages without this initial state continue through the API-only path.
			const fetching = state?.feed?.isFetching as
				{ __v_isRef?: unknown; value?: unknown } | boolean | undefined;
			const busy =
				typeof fetching === 'object' && fetching?.__v_isRef === true ? fetching.value : fetching;
			return !Array.isArray(state?.feed?.feeds) && busy !== true;
		},
		undefined,
		{ timeout },
	);
	await ready.dispose();
}

/** Reads only the home feed from the official page's already initialized state. */
export async function readInitialHomeFeed(page: Page, limit: number): Promise<unknown | undefined> {
	const serialized = await page.evaluate((maxLength) => {
		if (
			location.origin !== 'https://www.xiaohongshu.com' ||
			!['/', '/explore'].includes(location.pathname)
		) {
			return undefined;
		}
		// Vue wraps the server-provided array in a ref during hydration. Both shapes
		// describe the same feed; do not serialize the surrounding account state.
		const unwrap = (value: unknown): unknown => {
			const ref = value as { __v_isRef?: unknown; value?: unknown } | undefined;
			return ref?.__v_isRef === true ? ref.value : value;
		};
		const state = (
			window as unknown as { __INITIAL_STATE__?: { feed?: { feeds?: unknown; isError?: unknown } } }
		).__INITIAL_STATE__;
		const items = unwrap(state?.feed?.feeds);
		if (unwrap(state?.feed?.isError) === true || !Array.isArray(items) || items.length === 0) {
			return undefined;
		}
		// The initial state has no has_more flag. Keep pagination available until an
		// API response tells us that the stream has ended.
		const json = JSON.stringify({ data: { items, has_more: true } });
		return json.length <= maxLength ? json : null;
	}, limit);
	if (serialized === undefined) {
		return undefined;
	}
	if (serialized === null || Buffer.byteLength(serialized, 'utf8') > limit) {
		throw new SourceError('parse-failure', '页面首屏数据超过允许的读取大小。', false);
	}
	return JSON.parse(serialized) as unknown;
}
