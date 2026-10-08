import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LoginSnapshot } from '../../session/browser-session';
import { isLoginAssistantMessage, renderLoginAssistantHtml, toLoginAssistantViewState } from '../../webview/login-assistant-security';

const snapshot: LoginSnapshot = {
	status: 'waiting-scan',
	message: '<img src=x onerror=alert(1)>',
	qrImage: 'iVBORw0KGgoBAgM=',
	expiresAt: 1234,
};

test('accepts only fixed login assistant message commands', () => {
	assert.equal(isLoginAssistantMessage({ command: 'ready' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'show-qr' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'refresh-qr' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'close' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'refresh-qr', url: 'https://attacker.test' }), false);
	assert.equal(isLoginAssistantMessage({ command: 'open-url' }), false);
});

test('escapes status text and never sends QR image data to the WebView', () => {
	const html = renderLoginAssistantHtml(snapshot);
	const state = toLoginAssistantViewState(snapshot);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.match(html, /default-src 'none'/);
	assert.doesNotMatch(html, /img-src data:|data:image\/png;base64/);
	assert.equal('qrImage' in state, false);
	assert.equal(state.qrAvailable, true);
	assert.equal(html.includes('<script src='), false);
	assert.equal(toLoginAssistantViewState({ ...snapshot, qrImage: 'x'.repeat(1_400_001) }).qrAvailable, false);
});
