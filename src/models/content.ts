export type MediaType = 'image' | 'video' | 'mixed' | 'unknown';

export interface Author {
	id?: string;
	name: string;
	avatarUrl?: string;
}

export interface MediaItem {
	type: 'image' | 'video';
	url?: string;
	coverUrl?: string;
	width?: number;
	height?: number;
	alt?: string;
}

export interface NoteStats {
	likes?: number;
	comments?: number;
	collects?: number;
}

export interface FeedItem {
	id: string;
	title: string;
	excerpt?: string;
	author?: Author;
	coverUrl?: string;
	mediaType: MediaType;
	noteUrl: string;
	publishedAt?: string;
	stats?: NoteStats;
}

export interface NoteDetail extends FeedItem {
	body: string;
	media: MediaItem[];
	topics: string[];
}

export interface PageResult<T> {
	items: T[];
	nextCursor?: string;
}

export type SessionStatus = 'unknown' | 'logged-out' | 'logged-in' | 'expired';

export interface NoteSourceContext {
	readonly noteUrl?: string;
	readonly source?: 'home' | 'explore' | 'search' | 'external';
}
