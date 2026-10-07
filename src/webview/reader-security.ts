import { randomBytes } from 'node:crypto';
import type { NoteDetail } from '../models/content';

const IMAGE_HOSTS = ['xhscdn.com', 'xiaohongshu.com'];

export type ReaderMessage = { command: 'retry' } | { command: 'open-in-browser' };

export function isReaderMessage(value: unknown): value is ReaderMessage {
	if (typeof value !== 'object' || value === null || !('command' in value)) {return false;}
	const message = value as { command?: unknown };
	const keys = Object.keys(message);
	return keys.length === 1 && keys[0] === 'command' &&
		(message.command === 'retry' || message.command === 'open-in-browser');
}

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	})[character] ?? character);
}

export function trustedImageUrl(value: string | undefined): string | undefined {
	if (!value) {return undefined;}
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password) {return undefined;}
		const allowed = IMAGE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
		return allowed ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function formatStats(detail: NoteDetail): string {
	const parts = [
		detail.stats?.likes === undefined ? undefined : `赞 ${detail.stats.likes}`,
		detail.stats?.collects === undefined ? undefined : `收藏 ${detail.stats.collects}`,
		detail.stats?.comments === undefined ? undefined : `评论 ${detail.stats.comments}`,
	].filter((part): part is string => Boolean(part));
	return parts.map(escapeHtml).join(' · ');
}

function renderMedia(detail: NoteDetail): string {
	return detail.media.flatMap(media => {
		const url = trustedImageUrl(media.url ?? media.coverUrl);
		if (!url) {return [];}
		return [`<img src="${escapeHtml(url)}" alt="${escapeHtml(media.alt ?? detail.title)}" loading="lazy">`];
	}).join('');
}

export function renderNoteDetail(detail: NoteDetail): string {
	const author = detail.author?.name ? `<p class="author">${escapeHtml(detail.author.name)}</p>` : '';
	const topics = detail.topics.length
		? `<p class="topics">${detail.topics.map(topic => `#${escapeHtml(topic)}`).join('　')}</p>`
		: '';
	const stats = formatStats(detail);
	return `<article>
		${author}
		<h1>${escapeHtml(detail.title)}</h1>
		${detail.publishedAt ? `<p class="muted">${escapeHtml(detail.publishedAt)}</p>` : ''}
		${stats ? `<p class="muted">${stats}</p>` : ''}
		<div class="body">${escapeHtml(detail.body).replace(/\r?\n/g, '<br>')}</div>
		${topics}
		<div class="media">${renderMedia(detail)}</div>
	</article>`;
}

export function renderReaderHtml(title: string, content: string): string {
	const scriptNonce = randomBytes(18).toString('base64');
	const styleNonce = randomBytes(18).toString('base64');
	const csp = [
		"default-src 'none'",
		'img-src https://*.xhscdn.com https://*.xiaohongshu.com',
		`style-src 'nonce-${styleNonce}'`,
		`script-src 'nonce-${scriptNonce}'`,
	].join('; ');
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<title>${escapeHtml(title)}</title>
	<style nonce="${styleNonce}">
		:root { color-scheme: light dark; }
		body { max-width: 760px; margin: 0 auto; padding: 24px; color: var(--vscode-foreground); font: 14px/1.8 var(--vscode-font-family); }
		h1 { font-size: 22px; line-height: 1.4; margin: 8px 0 12px; }
		p { margin: 6px 0; }
		.author { font-weight: 600; }
		.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.body { margin: 24px 0; overflow-wrap: anywhere; }
		.topics { color: var(--vscode-textLink-foreground); }
		.media { display: grid; gap: 12px; }
		img { display: block; max-width: 100%; height: auto; border-radius: 4px; }
		.actions { display: flex; gap: 8px; margin: 8px 0 20px; }
		button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; padding: 6px 12px; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
	</style>
</head>
<body>
	<nav class="actions"><button data-command="open-in-browser">在浏览器中打开</button><button data-command="retry">重新读取</button></nav>
	<main>${content}</main>
	<script nonce="${scriptNonce}">
		const vscode = acquireVsCodeApi();
		document.querySelectorAll('button[data-command]').forEach(button => {
			button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
		});
	</script>
</body>
</html>`;
}
