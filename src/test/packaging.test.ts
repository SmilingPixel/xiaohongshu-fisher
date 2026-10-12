import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { listFiles } from '@vscode/vsce';

const execFileAsync = promisify(execFile);

// Recreate vsce's file layout outside the repository: workspace symlinks and
// ancestor node_modules must not hide missing dependencies in an installed VSIX.
test('packaged files load the browser library and its CLI in isolation', async () => {
	const root = path.resolve(__dirname, '../..');
	const files = await listFiles({ cwd: root });
	assert.ok(files.includes('out/extension.js'), 'The extension entry point must be packaged.');
	const directory = await mkdtemp(path.join(tmpdir(), 'xiaohongshu-fisher-package-'));
	try {
		for (const file of files) {
			const destination = path.join(directory, file);
			await mkdir(path.dirname(destination), { recursive: true });
			await copyFile(path.join(root, file), destination);
		}
		const probe = path.join(directory, 'verify-runtime.cjs');
		await writeFile(probe, `
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
assert.equal(typeof chromium.launchPersistentContext, 'function');
const manifest = require('./package.json');
assert.ok(require('node:fs').existsSync(require.resolve(manifest.main)));
`);
		const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
		await execFileAsync(process.execPath, [probe], { cwd: directory, env });
		const { stdout } = await execFileAsync(process.execPath,
			[path.join(directory, 'node_modules/playwright/cli.js'), '--version'], { cwd: directory, env });
		assert.match(stdout, /^Version \d+\.\d+\.\d+/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
