import * as assert from 'assert';
import * as vscode from 'vscode';
import { mock } from 'node:test';
import { XiaohongshuPageSource } from '../sources/xiaohongshu-page-source';

const commandIds = [
	'xiaohongshu-fisher.refreshHomeFeed',
	'xiaohongshu-fisher.refreshExploreFeed',
	'xiaohongshu-fisher.searchNotes',
	'xiaohongshu-fisher.loadMore',
	'xiaohongshu-fisher.openNote',
	'xiaohongshu-fisher.openInBrowser',
	'xiaohongshu-fisher.openLogin',
	'xiaohongshu-fisher.refreshLoginQr',
	'xiaohongshu-fisher.installBrowserRuntime',
	'xiaohongshu-fisher.clearSession',
];

suite('Extension Test Suite', () => {
	const extension = vscode.extensions.getExtension('SmilingPixel.xiaohongshu-fisher');
	assert.ok(extension);

	test('activates and registers each contributed command', async () => {
		await extension.activate();
		const registered = new Set(await vscode.commands.getCommands(true));
		const contributed = extension.packageJSON.contributes.commands.map(
			(command: { command: string }) => command.command,
		);

		assert.deepStrictEqual(contributed, commandIds);
		for (const commandId of commandIds) {
			assert.ok(registered.has(commandId), `${commandId} should be registered`);
		}
	});

	test('contributes the expected Activity Bar views', () => {
		const manifest = extension.packageJSON.contributes;
		assert.strictEqual(manifest.viewsContainers.activitybar[0].id, 'xiaohongshuFisher');
		assert.deepStrictEqual(
			manifest.views.xiaohongshuFisher.map((view: { id: string }) => view.id),
			[
				'xiaohongshuFisher.homeFeed',
				'xiaohongshuFisher.exploreFeed',
				'xiaohongshuFisher.searchResults',
			],
		);
	});

	test('resolves host-only access parameters for browser commands without opening a browser', async () => {
		await extension.activate();
		const noteUrl = 'https://www.xiaohongshu.com/explore/fixture-note';
		const resolvedUrl = `${noteUrl}?xsec_token=fixture-token&xsec_source=pc_feed`;
		const resolver = mock.method(XiaohongshuPageSource.prototype, 'getNoteUrl', (id: string) => {
			assert.strictEqual(id, 'fixture-note');
			return resolvedUrl;
		});
		const opened: string[] = [];
		const opener = mock.method(vscode.env, 'openExternal', async (uri: vscode.Uri) => {
			opened.push(uri.toString(true));
			return true;
		});
		try {
			const command = 'xiaohongshu-fisher.openInBrowser';
			await vscode.commands.executeCommand(command, { id: 'fixture-note', noteUrl });
			await vscode.commands.executeCommand(command, noteUrl);
			const suppliedUrl = `${noteUrl}?xsec_token=supplied-fixture&xsec_source=pc_search`;
			await vscode.commands.executeCommand(command, suppliedUrl);
			assert.deepStrictEqual(opened, [resolvedUrl, resolvedUrl, suppliedUrl]);
			assert.strictEqual(resolver.mock.callCount(), 2);
		} finally {
			opener.mock.restore();
			resolver.mock.restore();
		}
	});
});
