import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnoseBrowserStartup } from '../../session/browser-startup';

test('identifies the missing shared library in Chromium stderr without exposing launch arguments', () => {
	const failure = diagnoseBrowserStartup(new Error([
		'browserType.launchPersistentContext: Target page, context or browser has been closed',
		'<launching> /private/chromium --no-sandbox --user-data-dir=/private/profile',
		'[pid=27][err] /private/chromium: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory',
		'\x1b[2m  - [pid=27][err] /private/chromium: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory\x1b[22m',
	].join('\n')));
	assert.equal(failure.category, 'dependencies');
	assert.equal(failure.error.code, 'browser-dependencies');
	assert.deepEqual(failure.missingLibraries, ['libatk-1.0.so.0']);
	assert.match(failure.error.message, /libatk-1\.0\.so\.0/);
	assert.match(failure.error.message, /安装 Playwright Chromium/);
	assert.doesNotMatch(failure.error.message, /private|user-data-dir|no-sandbox/);
	assert.equal(failure.error.retryable, false);
});

test('handles Playwright dependency validation with package advice or a boxed library list', () => {
	const packages = diagnoseBrowserStartup(new Error('Host system is missing dependencies to run browsers.\nPlease install them with sudo apt-get install libatk1.0-0'));
	assert.equal(packages.category, 'dependencies');
	assert.deepEqual(packages.missingLibraries, []);

	const libraries = diagnoseBrowserStartup(new Error([
		'╔══════════════════════════════════════════════════╗',
		'║ Host system is missing dependencies to run browsers. ║',
		'║ Missing libraries:                               ║',
		'║     libatk-1.0.so.0                               ║',
		'║     libXcomposite.so.1                            ║',
		'╚══════════════════════════════════════════════════╝',
	].join('\n')));
	assert.deepEqual(libraries.missingLibraries, ['libatk-1.0.so.0', 'libXcomposite.so.1']);
});

test('reports a missing headless shell as a missing runtime', () => {
	const failure = diagnoseBrowserStartup(new Error("Executable doesn't exist at /private/chromium_headless_shell-1243/chrome-headless-shell"));
	assert.equal(failure.category, 'runtime-missing');
	assert.equal(failure.error.code, 'browser-missing');
	assert.match(failure.error.message, /安装 Playwright Chromium/);
	assert.match(failure.error.message, /无头/);
	assert.doesNotMatch(failure.error.message, /private|1243/);
});

test('recognizes sandbox failures using explicit diagnostics', () => {
	for (const reason of ['No usable sandbox!', 'Chromium sandboxing failed!', 'Failed to move to new namespace: Operation not permitted']) {
		const failure = diagnoseBrowserStartup(new Error(reason));
		assert.equal(failure.category, 'sandbox');
		assert.equal(failure.error.code, 'browser-startup');
	}
});

test('recognizes profile locks and filesystem permission failures without disclosing paths', () => {
	const profile = diagnoseBrowserStartup(new Error('Failed to create a ProcessSingleton for your profile directory: /private/profile'));
	assert.equal(profile.category, 'profile-in-use');
	assert.doesNotMatch(profile.error.message, /private/);
	for (const code of ['EACCES', 'EPERM']) {
		const failure = diagnoseBrowserStartup(Object.assign(new Error('mkdir /private/profile'), { code }));
		assert.equal(failure.category, 'permissions');
		assert.doesNotMatch(failure.error.message, /private/);
	}
	const deniedLock = diagnoseBrowserStartup(new Error('SingletonLock: Permission denied\nFailed to create a ProcessSingleton for your profile directory.'));
	assert.equal(deniedLock.category, 'permissions');
});

test('does not infer a sandbox failure from ordinary launch flags and paths', () => {
	const failure = diagnoseBrowserStartup(new Error('Target closed: chromium --no-sandbox --user-data-dir=/private/profile'));
	assert.equal(failure.category, 'unknown');
	assert.doesNotMatch(failure.error.message, /private|no-sandbox/);
});

test('keeps unrecognized errors and sensitive data out of diagnostic output', () => {
	const sensitive = 'https://www.xiaohongshu.com/?token=secret Cookie: session=secret QR=secret /private/profile';
	for (const error of [new Error(sensitive), sensitive, null, undefined, { message: sensitive }]) {
		const failure = diagnoseBrowserStartup(error);
		assert.equal(failure.category, 'unknown');
		assert.equal(failure.error.code, 'browser-startup');
		assert.deepEqual(failure.missingLibraries, []);
		assert.doesNotMatch(failure.error.message, /secret|Cookie|QR=|private/);
	}
});

test('bounds extracted library names and excludes paths and trailing diagnostic content', () => {
	const manyLibraries = Array.from({ length: 30 }, (_, index) => `    libtest${index}.so.1`).join('\n');
	const failure = diagnoseBrowserStartup(new Error(`Missing libraries:\n${manyLibraries}\n/private/libprivate.so\nlibtrailing.so`));
	assert.equal(failure.missingLibraries.length, 20);
	assert.doesNotMatch(failure.error.message, /libtest20|private|trailing/);
});
