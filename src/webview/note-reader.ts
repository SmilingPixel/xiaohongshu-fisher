import * as vscode from 'vscode';
import type { FeedItem } from '../models/content';
import { SourceError } from '../models/source-error';
import type { ContentApplicationService } from '../application/content-service';
import { escapeHtml, isReaderMessage, renderNoteDetail, renderReaderHtml } from './reader-security';

function trustedNoteUrl(value: string): vscode.Uri | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password ||
			!(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com'))) {
			return undefined;
		}
		return vscode.Uri.parse(url.toString());
	} catch {
		return undefined;
	}
}


export class NoteReader implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private item?: FeedItem;
	private requestVersion = 0;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly application: ContentApplicationService) {}

	async open(item: FeedItem): Promise<void> {
		this.item = item;
		const panel = this.getPanel();
		panel.title = item.title;
		panel.webview.html = renderReaderHtml(item.title, '<p>正在读取笔记…</p>');
		await this.loadDetail(item);
	}

	dispose(): void {
		this.disposables.forEach(disposable => disposable.dispose());
		this.panel?.dispose();
	}

	private getPanel(): vscode.WebviewPanel {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			return this.panel;
		}
		const panel = vscode.window.createWebviewPanel('xiaohongshuFisher.noteReader', '小红书笔记', vscode.ViewColumn.Active, {
			enableScripts: true,
			localResourceRoots: [],
		});
		this.panel = panel;
		this.disposables.push(panel.webview.onDidReceiveMessage((value: unknown) => this.onMessage(value)));
		this.disposables.push(panel.onDidDispose(() => { this.panel = undefined; this.item = undefined; }));
		return panel;
	}

	private async onMessage(value: unknown): Promise<void> {
		if (!isReaderMessage(value) || !this.item) {return;}
		if (value.command === 'retry') {
			await this.loadDetail(this.item);
			return;
		}
		const uri = trustedNoteUrl(this.item.noteUrl);
		if (uri) {await vscode.env.openExternal(uri);}
	}

	private async loadDetail(item: FeedItem): Promise<void> {
		const panel = this.panel;
		if (!panel) {return;}
		const version = ++this.requestVersion;
		try {
			const detail = await this.application.getNoteDetail(item.id, { noteUrl: item.noteUrl, source: 'external' });
			if (this.panel !== panel || this.item?.id !== item.id || version !== this.requestVersion) {return;}
			panel.title = detail.title;
			panel.webview.html = renderReaderHtml(detail.title, renderNoteDetail(detail));
		} catch (error) {
			if (this.panel !== panel || this.item?.id !== item.id || version !== this.requestVersion) {return;}
			const message = error instanceof SourceError ? error.message : '暂时无法读取笔记内容。';
			panel.webview.html = renderReaderHtml(item.title,
				`<h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(message)}</p><p>可以在小红书官方页面继续阅读。</p>`);
		}
	}
}
