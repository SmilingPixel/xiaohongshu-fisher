import * as l10n from '@vscode/l10n';
import { randomBytes } from 'node:crypto';
import type { NoteDetail } from '../models/content';
import { IMAGE_HOSTS, trustedImageUrl } from '../models/image-url';

export { trustedImageUrl } from '../models/image-url';

export type ReaderMessage = { command: 'retry' } | { command: 'open-in-browser' };

export function isReaderMessage(value: unknown): value is ReaderMessage {
	if (typeof value !== 'object' || value === null || !('command' in value)) {
		return false;
	}
	const message = value as { command?: unknown };
	const keys = Object.keys(message);
	return (
		keys.length === 1 &&
		keys[0] === 'command' &&
		(message.command === 'retry' || message.command === 'open-in-browser')
	);
}

export function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			})[character] ?? character,
	);
}

function formatStats(detail: NoteDetail, language: string): string {
	const numbers = new Intl.NumberFormat(language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en');
	const parts = [
		detail.stats?.likes === undefined
			? undefined
			: l10n.t('Likes: {count}', {
					count: numbers.format(detail.stats.likes),
				}),
		detail.stats?.collects === undefined
			? undefined
			: l10n.t('Saves: {count}', {
					count: numbers.format(detail.stats.collects),
				}),
		detail.stats?.comments === undefined
			? undefined
			: l10n.t('Comments: {count}', {
					count: numbers.format(detail.stats.comments),
				}),
	].filter((part): part is string => Boolean(part));
	return parts.map(escapeHtml).join(' · ');
}

function renderMedia(detail: NoteDetail): string {
	return detail.media
		.flatMap((media) => {
			const url = trustedImageUrl(media.url ?? media.coverUrl);
			if (!url) {
				return [];
			}
			return [
				`<img src="${escapeHtml(url)}" alt="${escapeHtml(media.alt ?? detail.title)}" loading="lazy">`,
			];
		})
		.join('');
}

export function renderNoteDetail(detail: NoteDetail, language = 'en'): string {
	const author = detail.author?.name
		? `<p class="author">${escapeHtml(detail.author.name)}</p>`
		: '';
	const topics = detail.topics.length
		? `<p class="topics">${detail.topics.map((topic) => `#${escapeHtml(topic)}`).join('　')}</p>`
		: '';
	const stats = formatStats(detail, language);
	let publishedAt = detail.publishedAt;
	if (publishedAt && !Number.isNaN(Date.parse(publishedAt))) {
		publishedAt = new Intl.DateTimeFormat(language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en', {
			dateStyle: 'medium',
			timeStyle: 'short',
		}).format(new Date(publishedAt));
	}
	return `<article>
		${author}
		<h1>${escapeHtml(detail.title)}</h1>
		${publishedAt ? `<p class="muted">${escapeHtml(publishedAt)}</p>` : ''}
		${stats ? `<p class="muted">${stats}</p>` : ''}
		<div class="body">${escapeHtml(detail.body).replace(/\r?\n/g, '<br>')}</div>
		${topics}
		<div class="media">${renderMedia(detail)}</div>
	</article>`;
}

/** Content must come from the escaped renderers; the shell grants scripts and styles per-document nonces. */
export function renderReaderHtml(title: string, content: string, language = 'en'): string {
	const scriptNonce = randomBytes(18).toString('base64');
	const styleNonce = randomBytes(18).toString('base64');
	const csp = [
		"default-src 'none'",
		`img-src ${IMAGE_HOSTS.flatMap((host) => [`https://${host}`, `https://*.${host}`]).join(' ')}`,
		`style-src 'nonce-${styleNonce}'`,
		`script-src 'nonce-${scriptNonce}'`,
	].join('; ');
	return /* HTML */ `<!DOCTYPE html>
		<html lang="${language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en'}">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<meta http-equiv="Content-Security-Policy" content="${csp}" />
				<title>${escapeHtml(title)}</title>
				<style nonce="${styleNonce}">
					:root {
						color-scheme: light dark;
					}
					body {
						max-width: 760px;
						margin: 0 auto;
						padding: 24px;
						color: var(--vscode-foreground);
						font: 14px/1.8 var(--vscode-font-family);
					}
					h1 {
						font-size: 22px;
						line-height: 1.4;
						margin: 8px 0 12px;
					}
					p {
						margin: 6px 0;
					}
					.author {
						font-weight: 600;
					}
					.muted {
						color: var(--vscode-descriptionForeground);
						font-size: 12px;
					}
					.body {
						margin: 24px 0;
						overflow-wrap: anywhere;
					}
					.topics {
						color: var(--vscode-textLink-foreground);
					}
					.media {
						display: grid;
						gap: 12px;
					}
					img {
						display: block;
						max-width: 100%;
						height: auto;
						border-radius: 4px;
					}
					.actions {
						display: flex;
						flex-wrap: wrap;
						gap: 8px;
						margin: 8px 0 20px;
					}
					button {
						color: var(--vscode-button-foreground);
						background: var(--vscode-button-background);
						border: 0;
						border-radius: 2px;
						padding: 6px 12px;
						cursor: pointer;
					}
					button:hover {
						background: var(--vscode-button-hoverBackground);
					}
				</style>
			</head>
			<body>
				<nav class="actions">
					<button data-command="open-in-browser">${escapeHtml(l10n.t('Open in Browser'))}</button
					><button data-command="retry">${escapeHtml(l10n.t('Reload'))}</button>
				</nav>
				<main>${content}</main>
				<script nonce="${scriptNonce}">
					const vscode = acquireVsCodeApi();
					document.querySelectorAll('button[data-command]').forEach((button) => {
						button.addEventListener('click', () =>
							vscode.postMessage({ command: button.dataset.command }),
						);
					});
				</script>
			</body>
		</html>`;
}
