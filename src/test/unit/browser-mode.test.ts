import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBrowserMode, resolveBrowserMode } from '../../session/browser-mode';

test('explicit browser modes are preserved', () => {
	assert.equal(resolveBrowserMode('visible', {}), 'visible');
	assert.equal(resolveBrowserMode('headless', { display: ':99' }), 'headless');
});

test('auto mode selects visible only when a graphics display is available', () => {
	assert.equal(resolveBrowserMode('auto', { display: ':0' }), 'visible');
	assert.equal(resolveBrowserMode('auto', { waylandDisplay: 'wayland-0' }), 'visible');
	assert.equal(resolveBrowserMode('auto', {}), 'headless');
	assert.equal(resolveBrowserMode('auto', { remote: true, platform: 'linux' }), 'headless');
	assert.equal(resolveBrowserMode('auto', { platform: 'darwin' }), 'visible');
	assert.equal(resolveBrowserMode('auto', { platform: 'win32' }), 'visible');
});

test('invalid configuration values fall back to auto', () => {
	assert.equal(normalizeBrowserMode('unexpected'), 'auto');
	assert.equal(normalizeBrowserMode(undefined), 'auto');
	assert.equal(normalizeBrowserMode('headless'), 'headless');
});
