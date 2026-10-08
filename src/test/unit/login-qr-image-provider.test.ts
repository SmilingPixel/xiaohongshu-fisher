import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeQrPngBase64 } from '../../session/login-qr-image';

test('accepts only bounded PNG image bytes for the temporary QR viewer', () => {
	const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64');
	assert.deepStrictEqual(decodeQrPngBase64(png), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]));
	assert.equal(decodeQrPngBase64(undefined), undefined);
	assert.equal(decodeQrPngBase64('not-a-png'), undefined);
	assert.equal(decodeQrPngBase64(`${png}x`), undefined);
});
