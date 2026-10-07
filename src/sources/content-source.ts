import type { FeedItem, NoteDetail, NoteSourceContext, PageResult, SessionStatus } from '../models/content';

export interface ContentSource {
	getHomeFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
	getExploreFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
	searchNotes(query: string, cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
	getNoteDetail(id: string, context?: NoteSourceContext, signal?: AbortSignal): Promise<NoteDetail>;
	getSessionStatus(): Promise<SessionStatus>;
	openLogin(): Promise<void>;
	dispose(): Promise<void>;
}
