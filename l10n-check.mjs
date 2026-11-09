import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import * as l10n from '@vscode/l10n';
import { getL10nJson } from '@vscode/l10n-dev';

const root = new URL('./', import.meta.url);

async function readJson(name) {
	return JSON.parse(await readFile(new URL(name, root), 'utf8'));
}

async function readSources(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === 'test') {
			continue;
		}
		const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
		if (entry.isDirectory()) {
			files.push(...(await readSources(url)));
		} else if (entry.name.endsWith('.ts')) {
			files.push({ contents: await readFile(url, 'utf8'), extension: '.ts' });
		}
	}
	return files;
}

function placeholders(value) {
	return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test('localization catalogs cover source messages, manifest keys, and matching placeholders', async () => {
	const manifest = await readJson('package.json');
	const english = await readJson('package.nls.json');
	const chinese = await readJson('package.nls.zh-cn.json');
	const messages = await readJson('l10n/bundle.l10n.json');
	const translations = await readJson('l10n/bundle.l10n.zh-cn.json');
	assert.deepEqual(messages, await getL10nJson(await readSources(new URL('src/', root))));
	for (const [source, translated] of [
		[english, chinese],
		[messages, translations],
	]) {
		assert.deepEqual(Object.keys(source).sort(), Object.keys(translated).sort());
		for (const [key, text] of Object.entries(source)) {
			assert.ok(translated[key].trim(), `Empty translation: ${key}`);
			assert.deepEqual(placeholders(text), placeholders(translated[key]), key);
		}
	}
	for (const match of JSON.stringify(manifest).matchAll(/%([\w.]+)%/g)) {
		assert.ok(english[match[1]], `Missing manifest message: ${match[1]}`);
	}
	l10n.config({ contents: translations });
	assert.equal(l10n.t('Loading…'), '正在加载…');
	assert.equal(l10n.t('Untranslated {value}', { value: 'fallback' }), 'Untranslated fallback');
});
