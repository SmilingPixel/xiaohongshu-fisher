import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyOfficialErrorRedirect } from '../../sources/official-page-error';

test('classifies the confirmed IP risk code without exposing query metadata', () => {
	const result = classifyOfficialErrorRedirect('https://www.xiaohongshu.com/website-login/error?error_code=300012&uuid=secret');
	assert.equal(result?.kind, 'ip-risk');
	assert.equal(result?.platformCode, '300012');
	assert.match(result?.message ?? '', /300012/);
	assert.doesNotMatch(result?.message ?? '', /secret|uuid/);
});

test('uses a generic official error for unknown, malformed, duplicate, or missing codes', () => {
	assert.equal(classifyOfficialErrorRedirect('https://www.xiaohongshu.com/website-login/error?error_code=400001')?.kind, 'official-error-page');
	assert.equal(classifyOfficialErrorRedirect('https://www.xiaohongshu.com/website-login/error?error_code=abc')?.platformCode, undefined);
	assert.equal(classifyOfficialErrorRedirect('https://www.xiaohongshu.com/website-login/error?error_code=300012&error_code=400001')?.platformCode, undefined);
	assert.equal(classifyOfficialErrorRedirect('https://www.xiaohongshu.com/website-login/error')?.platformCode, undefined);
});

test('enforces the official HTTPS route boundary', () => {
	assert.equal(classifyOfficialErrorRedirect('https://www.xiaohongshu.com/login?next=/website-login/error'), undefined);
	assert.equal(classifyOfficialErrorRedirect('https://xiaohongshu.com.evil.test/website-login/error?error_code=300012'), undefined);
	assert.equal(classifyOfficialErrorRedirect('http://www.xiaohongshu.com/website-login/error?error_code=300012'), undefined);
	assert.equal(classifyOfficialErrorRedirect('https://user:pass@www.xiaohongshu.com/website-login/error?error_code=300012'), undefined);
	assert.equal(classifyOfficialErrorRedirect('https://www.xiaohongshu.com/website-login/error/?error_code=300012')?.kind, 'ip-risk');
});
