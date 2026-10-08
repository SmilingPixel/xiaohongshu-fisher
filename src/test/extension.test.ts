import * as assert from 'assert';
import * as vscode from 'vscode';

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
	const extension = vscode.extensions.getExtension('xiaohongshu-fisher');
	assert.ok(extension);

	test('activates and registers each contributed command', async () => {
		await extension.activate();
		const registered = new Set(await vscode.commands.getCommands(true));
		const contributed = extension.packageJSON.contributes.commands.map(
			(command: { command: string }) => command.command
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
			]
		);
	});
});
