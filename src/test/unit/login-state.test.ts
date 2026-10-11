import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLoginState } from '../../session/login-state';

const base = {
	url: 'https://www.xiaohongshu.com/',
	now: 10_000,
	expiresAt: 100_000,
};

test('detects official QR waiting state and successful login text', () => {
	assert.equal(detectLoginState({ ...base, bodyText: '扫码登录', hasQr: true }).status, 'waiting-scan');
	assert.equal(detectLoginState({ ...base, bodyText: '我的主页 退出登录', hasQr: false }).status, 'logged-in');
});

test('keeps the page loading until a QR image is available', () => {
	assert.equal(detectLoginState({ ...base, bodyText: '扫码登录', hasQr: false }).status, 'loading');
});

test('detects official risk restriction pages', () => {
	assert.equal(detectLoginState({ ...base, url: 'https://www.xiaohongshu.com/website-login/error?error_code=300012', bodyText: '', hasQr: false }).status, 'access-restricted');
	assert.equal(detectLoginState({ ...base, url: 'https://www.xiaohongshu.com/website-login/error?error_code=400001', bodyText: '', hasQr: false }).status, 'page-error');
	assert.equal(detectLoginState({ ...base, url: 'https://www.xiaohongshu.com/website-login/error', bodyText: '安全限制 300012', hasQr: false }).status, 'page-error');
});

test('stops the login flow for verification and expired QR states', () => {
	assert.equal(detectLoginState({ ...base, bodyText: '请完成安全验证', hasQr: false }).status, 'verification-required');
	assert.equal(detectLoginState({ ...base, bodyText: '', hasQr: true, now: 100_000 }).status, 'expired');
	assert.equal(detectLoginState({ ...base, bodyText: '二维码已失效', hasQr: true }).status, 'expired');
});

test('does not assume login success when the page is still loading', () => {
	assert.equal(detectLoginState({ ...base, url: 'https://www.xiaohongshu.com/', bodyText: '', hasQr: false }).status, 'loading');
});
