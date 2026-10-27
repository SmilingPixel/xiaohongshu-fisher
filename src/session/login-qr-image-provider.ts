import * as vscode from 'vscode';
import { validateQrPng } from './login-qr-image';

const QR_IMAGE_PATH = '/login-qr.png';

/** Serves only the current, copied QR image as a versioned in-memory WebView resource. */
export class LoginQrImageProvider implements vscode.FileSystemProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this.changeEmitter.event;
	private image?: Uint8Array;
	private modifiedAt = Date.now();
	private readonly fileSystemRegistration: vscode.Disposable;
	private readonly uri = vscode.Uri.from({
		scheme: 'xiaohongshu-fisher-login',
		path: QR_IMAGE_PATH,
	});

	constructor() {
		this.fileSystemRegistration = vscode.workspace.registerFileSystemProvider(
			'xiaohongshu-fisher-login',
			this,
			{
				isReadonly: true,
			},
		);
	}

	getUri(): vscode.Uri {
		return this.uri.with({ query: `v=${this.modifiedAt}` });
	}

	setImage(value: Uint8Array | undefined): void {
		const image = validateQrPng(value);
		if (!image) {
			this.clear();
			return;
		}
		if (this.image?.length === image.length && this.image.every((byte, i) => byte === image[i])) {
			image.fill(0);
			return;
		}
		this.image?.fill(0);
		this.image = image;
		this.modifiedAt = Math.max(Date.now(), this.modifiedAt + 1);
		this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri: this.getUri() }]);
	}

	clear(): void {
		if (!this.image) {
			return;
		}
		const uri = this.getUri();
		this.image.fill(0);
		this.image = undefined;
		this.modifiedAt = Math.max(Date.now(), this.modifiedAt + 1);
		this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
	}

	watch(_uri: vscode.Uri): vscode.Disposable {
		return { dispose() {} };
	}

	stat(uri: vscode.Uri): vscode.FileStat {
		this.assertUri(uri);
		if (!this.image) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
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
		if (!this.image) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
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
		if (
			uri.scheme !== this.uri.scheme ||
			uri.authority !== this.uri.authority ||
			uri.path !== QR_IMAGE_PATH ||
			uri.query !== this.getUri().query
		) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}
}
