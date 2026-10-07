import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NoteDetail } from '../../models/content';
import { isReaderMessage, renderNoteDetail, renderReaderHtml, trustedImageUrl } from '../../webview/reader-security';

const detail: NoteDetail = {
	id: 'note-1',
	title: '<script>alert(1)</script>',
	body: 'safe text\n<img src=x onerror=alert(1)>',
	mediaType: 'image',
	noteUrl: 'https://www.xiaohongshu.com/explore/note-1',
	media: [
		{ type: 'image', url: 'https://sns-img.xhscdn.com/image.jpg', alt: 'cover' },
		{ type: 'image', url: 'https://attacker.example/image.jpg' },
		{ type: 'image', url: 'javascript:alert(1)' },
	],
	topics: ['topic <x>'],
};

test('accepts only the reader command message schema', () => {
	assert.equal(isReaderMessage({ command: 'retry' }), true);
	assert.equal(isReaderMessage({ command: 'open-in-browser' }), true);
	assert.equal(isReaderMessage({ command: 'retry', url: 'https://attacker.example' }), false);
	assert.equal(isReaderMessage({ command: 'execute' }), false);
	assert.equal(isReaderMessage(null), false);
});

test('renders note fields as text and only allows trusted HTTPS image hosts', () => {
	const html = renderNoteDetail(detail);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.match(html, /safe text<br>&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.match(html, /https:\/\/sns-img\.xhscdn\.com\/image\.jpg/);
	assert.doesNotMatch(html, /attacker\.example|javascript:/);
	assert.equal(trustedImageUrl('https://sub.xiaohongshu.com/image.jpg'), 'https://sub.xiaohongshu.com/image.jpg');
	assert.equal(trustedImageUrl('https://xiaohongshu.com.attacker.example/image.jpg'), undefined);
	assert.equal(trustedImageUrl('http://sns-img.xhscdn.com/image.jpg'), undefined);
});

test('uses a restrictive CSP and per-document nonces without remote scripts', () => {
	const html = renderReaderHtml('Reader', '<p>content</p>');
	const nonce = html.match(/script-src 'nonce-([^']+)'/)?.[1];
	assert.ok(nonce);
	assert.match(html, /default-src 'none'/);
	assert.match(html, /img-src https:\/\/\*\.xhscdn\.com https:\/\/\*\.xiaohongshu\.com/);
	assert.ok(html.includes(`<script nonce="${nonce}">`));
	assert.doesNotMatch(html, /<script[^>]+src=/);
});
