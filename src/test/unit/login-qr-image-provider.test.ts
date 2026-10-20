import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateQrPng } from '../../session/login-qr-image';

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
);

test('accepts a bounded PNG with valid dimensions and rejects malformed bytes', () => {
	assert.deepEqual(Buffer.from(validateQrPng(png) ?? []), png);
	assert.equal(validateQrPng(undefined), undefined);
	assert.equal(validateQrPng(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), undefined);
});
