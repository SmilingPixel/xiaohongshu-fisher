import * as vscode from 'vscode';

/**
 * Extension-wide diagnostic channel. Callers must pass only operational metadata;
 * authentication material, response bodies, URLs with query parameters, and QR data
 * are intentionally excluded from the logging API's expected usage.
 */
export class ExtensionLogger implements vscode.Disposable {
	private readonly channel: vscode.LogOutputChannel;

	constructor() {
		this.channel = vscode.window.createOutputChannel('Xiaohongshu Fisher', { log: true });
	}

	debug(message: string, ...args: unknown[]): void { this.channel.debug(message, ...args); }
	info(message: string, ...args: unknown[]): void { this.channel.info(message, ...args); }
	warn(message: string, ...args: unknown[]): void { this.channel.warn(message, ...args); }
	error(message: string, ...args: unknown[]): void { this.channel.error(message, ...args); }

	dispose(): void { this.channel.dispose(); }
}
