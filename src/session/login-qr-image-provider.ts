import * as vscode from 'vscode';
import { decodeQrPngBase64 } from './login-qr-image';

const QR_IMAGE_PATH = '/login-qr.png';

export class LoginQrImageProvider implements vscode.FileSystemProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.changeEmitter.event;
	private image?: Uint8Array;
	private modifiedAt = Date.now();
	private readonly fileSystemRegistration: vscode.Disposable;
	private readonly uri = vscode.Uri.from({ scheme: 'xiaohongshu-fisher-login', path: QR_IMAGE_PATH });

	constructor() {
		this.fileSystemRegistration = vscode.workspace.registerFileSystemProvider('xiaohongshu-fisher-login', this, {
			isReadonly: true,
		});
	}

	getUri(): vscode.Uri {
		return this.uri;
	}

	setBase64Image(value: string | undefined): void {
		const image = decodeQrPngBase64(value);
		if (!image) {this.clear(); return;}
		this.image?.fill(0);
		this.image = image;
		this.modifiedAt = Date.now();
		this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.uri }]);
	}

	clear(): void {
		if (!this.image) {return;}
		this.image.fill(0);
		this.image = undefined;
		this.modifiedAt = Date.now();
		this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri: this.uri }]);
		this.closeQrEditorTabs();
	}

	watch(_uri: vscode.Uri): vscode.Disposable {
		return { dispose() {} };
	}

	stat(uri: vscode.Uri): vscode.FileStat {
		this.assertUri(uri);
		if (!this.image) {throw vscode.FileSystemError.FileNotFound(uri);}
		return {
			type: vscode.FileType.File,
			ctime: this.modifiedAt,
			mtime: this.modifiedAt,
			size: this.image.byteLength,
		};
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
		this.assertUri(uri);
		throw vscode.FileSystemError.FileNotFound(uri);
	}

	createDirectory(uri: vscode.Uri): void {
		throw vscode.FileSystemError.NoPermissions(uri);
	}

	readFile(uri: vscode.Uri): Uint8Array {
		this.assertUri(uri);
		if (!this.image) {throw vscode.FileSystemError.FileNotFound(uri);}
		return Uint8Array.from(this.image);
	}

	writeFile(uri: vscode.Uri): void {
		throw vscode.FileSystemError.NoPermissions(uri);
	}

	delete(uri: vscode.Uri): void {
		throw vscode.FileSystemError.NoPermissions(uri);
	}

	rename(oldUri: vscode.Uri): void {
		throw vscode.FileSystemError.NoPermissions(oldUri);
	}

	dispose(): void {
		this.clear();
		this.changeEmitter.dispose();
		this.fileSystemRegistration.dispose();
	}

	private assertUri(uri: vscode.Uri): void {
		if (uri.scheme !== this.uri.scheme || uri.path !== QR_IMAGE_PATH) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	private closeQrEditorTabs(): void {
		const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs.filter(tab => {
			const input = tab.input as { uri?: vscode.Uri };
			return input.uri?.toString() === this.uri.toString();
		}));
		if (tabs.length > 0) {void vscode.window.tabGroups.close(tabs);}
	}
}
