import type { FeedItem, NoteDetail, NoteSourceContext, PageResult } from '../models/content';
import { SourceError, toSourceError } from '../models/source-error';
import type { ContentSource } from '../sources/content-source';
import type { ExtensionLogger } from '../logging';

export type FeedKey = 'home' | 'explore' | 'search';

export interface FeedState {
	items: FeedItem[];
	isLoading: boolean;
	isLoadingMore: boolean;
	nextCursor?: string;
	error?: SourceError;
	lastUpdatedAt?: number;
	query?: string;
}

type StateListener = (key: FeedKey, state: Readonly<FeedState>) => void;
type FeedLoader = (cursor: string | undefined, signal: AbortSignal) => Promise<PageResult<FeedItem>>;

function emptyState(): FeedState {
	return { items: [], isLoading: false, isLoadingMore: false };
}

function mergeById(existing: FeedItem[], incoming: FeedItem[]): FeedItem[] {
	const items = new Map(existing.map(item => [item.id, item]));
	for (const item of incoming) {
		if (!items.has(item.id)) {
			items.set(item.id, item);
		}
	}
	return [...items.values()];
}

export class ContentApplicationService {
	private readonly states: Record<FeedKey, FeedState> = {
		home: emptyState(),
		explore: emptyState(),
		search: emptyState(),
	};
	private readonly requests = new Map<FeedKey, AbortController>();
	private readonly listeners = new Set<StateListener>();

	constructor(private readonly source: ContentSource, private readonly logger?: ExtensionLogger) {}

	getState(key: FeedKey): Readonly<FeedState> {
		return { ...this.states[key], items: [...this.states[key].items] };
	}

	subscribe(listener: StateListener): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	refreshHomeFeed(): Promise<void> {
		return this.loadFirst('home', (cursor, signal) => this.source.getHomeFeed(cursor, signal));
	}

	refreshExploreFeed(): Promise<void> {
		return this.loadFirst('explore', (cursor, signal) => this.source.getExploreFeed(cursor, signal));
	}

	searchNotes(query: string): Promise<void> {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) {
			return Promise.reject(new SourceError('invalid-query', '请输入搜索关键词。', false));
		}

		this.cancel('search');
		this.states.search = { ...emptyState(), query: normalizedQuery };
		this.publish('search');
		return this.loadFirst('search', (cursor, signal) => this.source.searchNotes(normalizedQuery, cursor, signal), true);
	}

	loadMore(key: FeedKey): Promise<void> {
		const state = this.states[key];
		if (state.isLoading || state.isLoadingMore || !state.nextCursor || this.requests.has(key)) {
			return Promise.resolve();
		}

		const cursor = state.nextCursor;
		const controller = new AbortController();
		this.requests.set(key, controller);
		state.isLoadingMore = true;
		state.error = undefined;
		this.publish(key);

		return this.runRequest(key, controller, async () => {
			const page = await this.getLoader(key)(cursor, controller.signal);
			if (this.requests.get(key) !== controller || controller.signal.aborted) {
				return;
			}
			const current = this.states[key];
			current.items = mergeById(current.items, page.items);
			current.nextCursor = page.nextCursor;
			current.lastUpdatedAt = Date.now();
		}, true);
	}

	async getNoteDetail(id: string, context?: NoteSourceContext, signal?: AbortSignal): Promise<NoteDetail> {
		try {
			return await this.source.getNoteDetail(id, context, signal);
		} catch (error) {
			throw toSourceError(error);
		}
	}

	cancel(key: FeedKey): void {
		this.requests.get(key)?.abort();
	}

	dispose(): void {
		for (const controller of this.requests.values()) {
			controller.abort();
		}
		this.requests.clear();
		this.listeners.clear();
	}

	private loadFirst(key: FeedKey, loader: FeedLoader, alreadyCancelled = false): Promise<void> {
		if (!alreadyCancelled) {
			this.cancel(key);
		}
		const controller = new AbortController();
		this.requests.set(key, controller);
		const state = this.states[key];
		state.isLoading = true;
		state.isLoadingMore = false;
		state.error = undefined;
		this.publish(key);

		return this.runRequest(key, controller, async () => {
			const page = await loader(undefined, controller.signal);
			if (this.requests.get(key) !== controller || controller.signal.aborted) {
				return;
			}
			const current = this.states[key];
			current.items = mergeById([], page.items);
			current.nextCursor = page.nextCursor;
			current.lastUpdatedAt = Date.now();
		}, false);
	}

	private async runRequest(
		key: FeedKey,
		controller: AbortController,
		operation: () => Promise<void>,
		isLoadingMore: boolean
	): Promise<void> {
		try {
			this.logger?.debug('Loading %s feed%s.', key, isLoadingMore ? ' next page' : '');
			await operation();
			this.logger?.debug('Loaded %s feed%s.', key, isLoadingMore ? ' next page' : '');
		} catch (error) {
			if (!controller.signal.aborted) {
				const sourceError = toSourceError(error);
				this.logger?.warn('Loading %s feed failed (%s).', key, sourceError.code);
			}
			if (!controller.signal.aborted && this.requests.get(key) === controller) {
				this.states[key].error = toSourceError(error);
			}
		} finally {
			if (this.requests.get(key) === controller) {
				this.requests.delete(key);
				this.states[key].isLoading = false;
				this.states[key].isLoadingMore = false;
				this.publish(key);
			} else if (isLoadingMore && !this.requests.has(key)) {
				this.states[key].isLoadingMore = false;
				this.publish(key);
			}
		}
	}

	private getLoader(key: FeedKey): FeedLoader {
		if (key === 'home') {
			return (cursor, signal) => this.source.getHomeFeed(cursor, signal);
		}
		if (key === 'explore') {
			return (cursor, signal) => this.source.getExploreFeed(cursor, signal);
		}
		const query = this.states.search.query;
		if (!query) {
			throw new SourceError('invalid-query', '请输入搜索关键词。', false);
		}
		return (cursor, signal) => this.source.searchNotes(query, cursor, signal);
	}

	private publish(key: FeedKey): void {
		const state = this.getState(key);
		for (const listener of this.listeners) {
			listener(key, state);
		}
	}
}
