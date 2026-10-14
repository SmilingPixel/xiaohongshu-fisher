import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLoginQrResponse } from '../../session/login-qr';

const url = 'https://www.xiaohongshu.com/mobile/login?qrId=id-1&xhs_code=0007&timestamp=1';

test('parses and preserves the trusted QR challenge URL', () => {
	const result = parseLoginQrResponse({ code: 0, success: true, data: { qr_id: 'id-1', code: '0007', url } }, 42);
	assert.equal(result.ok, true);
	if (result.ok) {assert.equal(result.challenge.url, url); assert.equal(result.challenge.code, '0007');}
});

test('rejects mismatched or untrusted challenge URLs', () => {
	assert.equal(parseLoginQrResponse({ code: 0, success: true, data: { qr_id: 'id', code: '1', url: 'https://evil.test/mobile/login?qrId=id&xhs_code=1' } }, 1).ok, false);
	assert.equal(parseLoginQrResponse({ code: 0, success: true, data: { qr_id: 'id', code: '1', url: 'https://www.xiaohongshu.com/mobile/login?qrId=id&qrId=id&xhs_code=1' } }, 1).ok, false);
});
