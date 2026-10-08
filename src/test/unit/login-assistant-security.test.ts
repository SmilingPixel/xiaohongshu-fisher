import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LoginSnapshot } from '../../session/browser-session';
import { isLoginAssistantMessage, renderLoginAssistantHtml, toLoginAssistantViewState } from '../../webview/login-assistant-security';

const snapshot: LoginSnapshot = {
	status: 'waiting-scan',
	message: '<img src=x onerror=alert(1)>',
	qrImage: 'ZmFrZS1xci1pbWFnZQ==',
	expiresAt: 1234,
};

test('accepts only fixed login assistant message commands', () => {
	assert.equal(isLoginAssistantMessage({ command: 'ready' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'refresh-qr' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'close' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'refresh-qr', url: 'https://attacker.test' }), false);
	assert.equal(isLoginAssistantMessage({ command: 'open-url' }), false);
});

test('escapes status text and embeds only bounded QR data under a restrictive CSP', () => {
	const html = renderLoginAssistantHtml(snapshot);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.match(html, /img-src data:/);
	assert.match(html, /default-src 'none'/);
	assert.doesNotMatch(html, /script[^>]+src=/);
	assert.equal(toLoginAssistantViewState({ ...snapshot, qrImage: 'x'.repeat(1_400_001) }).qrImage, undefined);
});
