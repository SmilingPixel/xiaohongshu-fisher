import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeImageUrl } from '../../models/image-url';
import { renderNoteDetail } from '../../webview/reader-security';
import {
	getNoteToken,
	normalizeFeedItem,
	normalizeNoteDetail,
	normalizePageResponse,
} from '../../sources/normalize';

const pageFixture = {
	success: true,
	data: {
		has_more: true,
		items: [
			{
				xsec_token: 'fixture-token-only',
				xsec_source: 'pc_search',
				note_card: {
					note_id: 'fixture-note-01',
					display_title: '虚构的阅读清单',
					desc: '这是一条只用于字段映射测试的内容。',
					type: 'normal',
					user: {
						user_id: 'fixture-user',
						nickname: '样例作者',
						avatar: 'https://sns-img.xhscdn.com/avatar.jpg',
					},
					image_list: [{ info_list: [{ url_default: 'https://sns-img.xhscdn.com/cover.jpg' }] }],
					interact_info: { liked_count: '1,234', comment_count: '18', collected_count: '56' },
					publish_time: 1_750_000_000_000,
				},
			},
			{ note_card: { display_title: '缺少 ID 的条目' } },
		],
	},
};

test('normalizes supported feed fields and omits platform token from view models', () => {
	const page = normalizePageResponse(pageFixture);
	assert.equal(page.hasMore, true);
	assert.equal(page.items.length, 1);
	assert.deepStrictEqual(page.items[0], {
		id: 'fixture-note-01',
		title: '虚构的阅读清单',
		excerpt: '这是一条只用于字段映射测试的内容。',
		author: {
			id: 'fixture-user',
			name: '样例作者',
			avatarUrl: 'https://sns-img.xhscdn.com/avatar.jpg',
		},
		coverUrl: 'https://sns-img.xhscdn.com/cover.jpg',
		mediaType: 'image',
		noteUrl: 'https://www.xiaohongshu.com/explore/fixture-note-01',
		publishedAt: new Date(1_750_000_000_000).toISOString(),
		stats: { likes: 1234, comments: 18, collects: 56 },
	});
	assert.equal(JSON.stringify(page.items).includes('fixture-token-only'), false);
	assert.deepStrictEqual(getNoteToken(pageFixture.data.items[0]), {
		token: 'fixture-token-only',
		source: 'pc_search',
	});
});

test('supports camel-case note detail payloads and ignores untrusted media', () => {
	const detail = normalizeNoteDetail({
		data: {
			items: [
				{
					note_card: {
						noteId: 'fixture-note-02',
						displayTitle: '视频笔记',
						desc: '视频详情样例',
						type: 'video',
						video: { coverUrl: 'http://unsafe.test/video.jpg' },
						tagList: [{ name: '阅读' }],
					},
				},
			],
		},
	});
	assert.equal(detail.id, 'fixture-note-02');
	assert.equal(detail.body, '视频详情样例');
	assert.equal(detail.mediaType, 'video');
	assert.deepStrictEqual(detail.topics, ['阅读']);
	assert.deepStrictEqual(detail.media, [{ type: 'video', coverUrl: undefined }]);
});

test('renders CDN images from HTTP addresses and usable fallback candidates', () => {
	const detail = normalizeNoteDetail({
		noteId: 'image-fixture',
		imageList: [
			{ urlDefault: 'http://sns-webpic-qc.xhscdn.com/fixture.jpg?format=webp' },
			{ infoList: [{ url: '' }, { url: 'https://sns-img.xhscdn.com/second.jpg' }] },
			{
				infoList: [{ url: 'https://untrusted.example/image.jpg' }],
				urlDefault: 'javascript:alert(1)',
				urlPre: '//sns-img.xhscdn.com/fallback.jpg',
			},
		],
	});
	assert.deepEqual(
		detail.media.map((image) => image.url),
		[
			'https://sns-webpic-qc.xhscdn.com/fixture.jpg?format=webp',
			'https://sns-img.xhscdn.com/second.jpg',
			'https://sns-img.xhscdn.com/fallback.jpg',
		],
	);
	const html = renderNoteDetail(detail);
	assert.equal(html.match(/<img /g)?.length, 3);
	assert.doesNotMatch(html, /http:|untrusted\.example|javascript:/);
});

test('rejects unsafe image URLs instead of upgrading arbitrary hosts', () => {
	for (const url of [
		'http://xhscdn.com.attacker.example/image.jpg',
		'https://user:password@sns-img.xhscdn.com/image.jpg',
		'https://sns-img.xhscdn.com:8443/image.jpg',
		'javascript:alert(1)',
		'data:image/png;base64,fixture',
	]) {
		assert.equal(normalizeImageUrl(url), undefined);
	}
});

test('drops malformed records and rejects unexpected page shapes', () => {
	assert.equal(normalizeFeedItem(null), undefined);
	assert.equal(normalizeFeedItem({ note_card: { display_title: 'no id' } }), undefined);
	assert.throws(() => normalizePageResponse({ data: { entries: [] } }), { code: 'parse-failure' });
});

test('preserves array alias precedence, including an explicitly empty primary field', () => {
	const note = { noteId: 'alias-note', title: 'Alias fixture' };
	assert.deepStrictEqual(normalizePageResponse({ items: [], notes: [note] }).items, []);
	assert.equal(normalizePageResponse({ items: null, notes: [note] }).items[0].id, note.noteId);

	const detail = normalizeNoteDetail({
		...note,
		image_list: [],
		images: [{ url: 'https://sns-img.xhscdn.com/fallback.jpg' }],
		tag_list: [],
		tagList: [{ name: 'Fallback topic' }],
	});
	assert.deepStrictEqual(detail.media, []);
	assert.deepStrictEqual(detail.topics, []);
});

test('falls back to alternate media fields when primary fields are malformed', () => {
	const detail = normalizeNoteDetail({
		noteId: 'media-alias-note',
		image_list: null,
		images: [
			{ info_list: null, infoList: [{ urlDefault: 'https://sns-img.xhscdn.com/image.jpg' }] },
		],
		tag_list: null,
		tagList: [{ tagName: 'Sample topic' }],
	});
	assert.deepStrictEqual(detail.media, [
		{ type: 'image', url: 'https://sns-img.xhscdn.com/image.jpg' },
	]);
	assert.deepStrictEqual(detail.topics, ['Sample topic']);
});

test('preserves explicit pagination flags before inferring from usable home feed items', () => {
	const items = [{ noteId: 'pagination-note' }];
	assert.equal(normalizePageResponse({ items }).hasMore, false);
	assert.equal(normalizePageResponse({ items }, true).hasMore, true);
	assert.equal(normalizePageResponse({ items: [] }, true).hasMore, false);
	assert.equal(normalizePageResponse({ items: [{}] }, true).hasMore, false);
	assert.equal(
		normalizePageResponse({ items, has_more: false, hasMore: true }, true).hasMore,
		false,
	);
	assert.equal(
		normalizePageResponse({ items, has_more: null, hasMore: false }, true).hasMore,
		false,
	);
	assert.equal(normalizePageResponse({ items: [], hasMore: true }, true).hasMore, true);
});
