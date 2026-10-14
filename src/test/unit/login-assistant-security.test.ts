import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LoginSnapshot } from '../../session/login-model';
import { isLoginAssistantMessage, renderLoginAssistantHtml, toLoginAssistantViewState } from '../../webview/login-assistant-security';

const snapshot: LoginSnapshot = { status: 'waiting-scan', message: '<img src=x onerror=alert(1)>', qrPng: Uint8Array.from([1]), qrRevision: 1, expiresAt: 1234 };

test('accepts only fixed login assistant message commands', () => {
	assert.equal(isLoginAssistantMessage({ command: 'ready' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'show-qr' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'refresh-qr' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'open-official-page' }), true);
	assert.equal(isLoginAssistantMessage({ command: 'refresh-qr', url: 'https://attacker.test' }), false);
});

test('escapes status text and never sends QR image data to the WebView', () => {
	const html = renderLoginAssistantHtml(snapshot); const state = toLoginAssistantViewState(snapshot);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(html, /default-src 'none'/);
	assert.doesNotMatch(html, /data:image\/png;base64/); assert.equal('qrPng' in state, false); assert.equal(state.qrAvailable, true);
});

test('hides QR and countdown for terminal states', () => {
	const terminal: LoginSnapshot = { status: 'access-restricted', message: '风险限制', qrPng: snapshot.qrPng, qrRevision: 2, expiresAt: 1234, pageUrl: 'https://www.xiaohongshu.com/website-login/error' };
	const state = toLoginAssistantViewState(terminal); const html = renderLoginAssistantHtml(terminal);
	assert.equal(state.qrAvailable, false); assert.equal(state.expiresAt, 0); assert.match(html, /重新尝试登录/); assert.match(html, /let expiresAt = 0;/);
	assert.equal(state.pageUrl, 'https://www.xiaohongshu.com/');
});
