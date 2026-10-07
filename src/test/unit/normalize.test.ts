import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNoteToken, normalizeFeedItem, normalizeNoteDetail, normalizePageResponse } from '../../sources/normalize';

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
					user: { user_id: 'fixture-user', nickname: '样例作者', avatar: 'https://example.test/avatar.jpg' },
					image_list: [{ info_list: [{ url_default: 'https://example.test/cover.jpg' }] }],
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
			avatarUrl: 'https://example.test/avatar.jpg',
		},
		coverUrl: 'https://example.test/cover.jpg',
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

test('supports camel-case note detail payloads and safely ignores non-HTTPS media', () => {
	const detail = normalizeNoteDetail({
		data: {
			items: [{
				note_card: {
					noteId: 'fixture-note-02',
					displayTitle: '视频笔记',
					desc: '视频详情样例',
					type: 'video',
					video: { coverUrl: 'http://unsafe.test/video.jpg' },
					tagList: [{ name: '阅读' }],
				},
			}],
		},
	});
	assert.equal(detail.id, 'fixture-note-02');
	assert.equal(detail.body, '视频详情样例');
	assert.equal(detail.mediaType, 'video');
	assert.deepStrictEqual(detail.topics, ['阅读']);
	assert.deepStrictEqual(detail.media, [{ type: 'video', coverUrl: undefined }]);
});

test('drops malformed records and rejects unexpected page shapes', () => {
	assert.equal(normalizeFeedItem(null), undefined);
	assert.equal(normalizeFeedItem({ note_card: { display_title: 'no id' } }), undefined);
	assert.throws(() => normalizePageResponse({ data: { entries: [] } }), { code: 'parse-failure' });
});
