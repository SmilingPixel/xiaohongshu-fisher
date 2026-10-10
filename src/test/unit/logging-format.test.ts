import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLogMessage } from '../../logging-format';

test('formats printf-style logger placeholders before output', () => {
	assert.equal(
		formatLogMessage('Extension activated (browser mode: %s, remote: %s).', ['headless', true]),
		'Extension activated (browser mode: headless, remote: true).',
	);
});

test('preserves useful formatting for numeric and extra metadata values', () => {
	assert.equal(formatLogMessage('QR wait timeout: %d ms.', [15_000]), 'QR wait timeout: 15000 ms.');
	assert.equal(formatLogMessage('Operation completed.', ['extra', 42]), 'Operation completed. extra 42');
});
