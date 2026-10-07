import type { FeedItem, MediaItem, MediaType, NoteDetail, PageResult } from '../models/content';
import { SourceError } from '../models/source-error';

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as RawRecord
		: undefined;
}

function firstRecord(record: RawRecord, ...keys: string[]): RawRecord | undefined {
	for (const key of keys) {		const value = asRecord(record[key]);
		if (value) {return value;}
	}
	return undefined;
}

function firstString(record: RawRecord, ...keys: string[]): string | undefined {
	for (const key of keys) {		const value = record[key];
		if (typeof value === 'string' && value.trim()) {return value.trim();}
		if (typeof value === 'number' && Number.isFinite(value)) {return String(value);}
	}
	return undefined;
}

function toCount(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {return value;}
	if (typeof value === 'string') {
		const parsed = Number(value.replaceAll(',', ''));
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function count(record: RawRecord, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = toCount(record[key]);
		if (value !== undefined) {return value;}
	}
	return undefined;
}

function safeHttpsUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') {return undefined;}
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function getRawCard(value: unknown): RawRecord | undefined {
	const record = asRecord(value);
	return record ? firstRecord(record, 'note_card', 'noteCard') ?? record : undefined;
}

function getIdentity(card: RawRecord): string | undefined {
	return firstString(card, 'note_id', 'noteId', 'id');
}

function getImages(card: RawRecord): MediaItem[] {
	const images = Array.isArray(card.image_list)
		? card.image_list
		: Array.isArray(card.images)
			? card.images
			: [];
	return images.flatMap(value => {
		const image = asRecord(value);
		if (!image) {return [];}
		const infoList = Array.isArray(image.info_list)
			? image.info_list
			: Array.isArray(image.infoList)
				? image.infoList
				: [];
		const info = asRecord(infoList[0]) ?? image;
		const url = safeHttpsUrl(firstString(info, 'url_default', 'urlDefault', 'url_pre', 'urlPre', 'url'));
		return url ? [{ type: 'image' as const, url }] : [];
	});
}

function getVideo(card: RawRecord): MediaItem | undefined {
	const video = firstRecord(card, 'video', 'video_info', 'videoInfo');
	if (!video && firstString(card, 'type') !== 'video') {return undefined;}
	const cover = firstRecord(video ?? card, 'cover', 'origin_cover', 'originCover');
	const coverUrl = safeHttpsUrl(
		firstString(cover ?? {}, 'url', 'url_default', 'urlDefault')
			?? firstString(video ?? card, 'cover_url', 'coverUrl')
	);
	return { type: 'video', coverUrl };
}

function getAuthor(card: RawRecord): FeedItem['author'] {
	const user = firstRecord(card, 'user', 'user_info', 'userInfo');
	if (!user) {return undefined;}
	const name = firstString(user, 'nickname', 'name', 'nick_name');
	if (!name) {return undefined;}
	const avatarUrl = safeHttpsUrl(firstString(user, 'avatar', 'avatar_url', 'avatarUrl'));
	return {
		id: firstString(user, 'user_id', 'userId', 'id'),
		name,
		avatarUrl,
	};
}

function getStats(card: RawRecord): FeedItem['stats'] {
	const interact = firstRecord(card, 'interact_info', 'interactInfo') ?? {};
	const stats = {
		likes: count(interact, 'liked_count', 'likedCount', 'likes'),
		comments: count(interact, 'comment_count', 'commentCount', 'comments'),
		collects: count(interact, 'collected_count', 'collectedCount', 'collects'),
	};
	return Object.values(stats).some(value => value !== undefined) ? stats : undefined;
}

function getMediaType(card: RawRecord, media: MediaItem[]): MediaType {
	const hasVideo = media.some(item => item.type === 'video');
	const hasImage = media.some(item => item.type === 'image');
	if (hasVideo && hasImage) {return 'mixed';}
	if (hasVideo) {return 'video';}
	if (hasImage) {return 'image';}
	if (firstString(card, 'type') === 'video') {return 'video';}
	return 'unknown';
}

export function normalizeFeedItem(value: unknown): FeedItem | undefined {
	const card = getRawCard(value);
	if (!card) {return undefined;}
	const id = getIdentity(card);
	if (!id) {return undefined;}

	const excerpt = firstString(card, 'desc', 'description', 'content');
	const title = firstString(card, 'display_title', 'displayTitle', 'title')
		?? excerpt?.slice(0, 120)
		?? '无标题笔记';
	const media = getImages(card);
	const video = getVideo(card);
	if (video) {media.unshift(video);}
	const cover = firstRecord(card, 'cover', 'cover_image', 'coverImage');
	const coverUrl = safeHttpsUrl(
		firstString(cover ?? {}, 'url_default', 'urlDefault', 'url')
			?? media.find(item => item.type === 'image')?.url
			?? video?.coverUrl
	);
	const time = count(card, 'time', 'publish_time', 'publishTime');
	const publishedAt = time === undefined
		? undefined
		: new Date(time < 10_000_000_000 ? time * 1000 : time).toISOString();

	return {
		id,
		title,
		excerpt: excerpt?.slice(0, 400),
		author: getAuthor(card),
		coverUrl,
		mediaType: getMediaType(card, media),
		noteUrl: `https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}`,
		publishedAt,
		stats: getStats(card),
	};
}

export function normalizePageResponse(value: unknown): PageResult<FeedItem> & { hasMore: boolean } {
	const root = asRecord(value);
	const data = root ? firstRecord(root, 'data') ?? root : undefined;
	if (!data) {
		throw new SourceError('parse-failure', '页面返回的数据格式暂不支持。', false);
	}
	const rawItems = Array.isArray(data.items)
		? data.items
		: Array.isArray(data.notes)
			? data.notes
			: undefined;
	if (!rawItems) {
		throw new SourceError('parse-failure', '页面返回的数据格式暂不支持。', false);
	}
	const items = rawItems.flatMap(item => {
		const normalized = normalizeFeedItem(item);
		return normalized ? [normalized] : [];
	});
	const hasMore = data.has_more === true || data.hasMore === true;
	return { items, hasMore };
}

export function normalizeNoteDetail(value: unknown): NoteDetail {
	const root = asRecord(value);
	const data = root ? firstRecord(root, 'data') ?? root : undefined;
	const items = data && Array.isArray(data.items) ? data.items : [];
	const card = getRawCard(items[0]) ?? getRawCard(value);
	const feedItem = card ? normalizeFeedItem(card) : undefined;
	if (!card || !feedItem) {
		throw new SourceError('not-found', '笔记暂时无法读取。', false);
	}

	const media = getImages(card);
	const video = getVideo(card);
	if (video) {media.unshift(video);}
	const tags = Array.isArray(card.tag_list)
		? card.tag_list
		: Array.isArray(card.tagList)
			? card.tagList
			: [];
	const topics = tags.length > 0
		? tags.flatMap(tag => {
			const record = asRecord(tag);
			const name = record ? firstString(record, 'name', 'tag_name', 'tagName') : undefined;
			return name ? [name] : [];
		})
		: [];
	return { ...feedItem, body: firstString(card, 'desc', 'description', 'content') ?? '', media, topics };
}

export function getNoteToken(value: unknown): { token?: string; source?: string } {
	const record = asRecord(value);
	return {
		token: record ? firstString(record, 'xsec_token', 'xsecToken') : undefined,
		source: record ? firstString(record, 'xsec_source', 'xsecSource') : undefined,
	};
}
