import { randomBytes } from 'node:crypto';
import type { LoginSnapshot } from '../session/browser-session';

export type LoginAssistantMessage = { command: 'ready' } | { command: 'refresh-qr' } | { command: 'close' };

export function isLoginAssistantMessage(value: unknown): value is LoginAssistantMessage {
	if (typeof value !== 'object' || value === null || !('command' in value)) {return false;}
	const message = value as { command?: unknown };
	const keys = Object.keys(message);
	return keys.length === 1 && keys[0] === 'command' &&
		(message.command === 'ready' || message.command === 'refresh-qr' || message.command === 'close');
}

export function toLoginAssistantViewState(snapshot: LoginSnapshot): {
	status: string;
	message: string;
	qrImage?: string;
	expiresAt: number;
} {
	const qrImage = snapshot.qrImage && snapshot.qrImage.length <= 1_400_000 && /^[A-Za-z0-9+/=]+$/.test(snapshot.qrImage)
		? snapshot.qrImage
		: undefined;
	return {
		status: snapshot.status,
		message: snapshot.message.slice(0, 500),
		qrImage,
		expiresAt: Number.isFinite(snapshot.expiresAt) ? snapshot.expiresAt : 0,
	};
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	})[character] ?? character);
}

export function renderLoginAssistantHtml(snapshot: LoginSnapshot): string {
	const scriptNonce = randomBytes(18).toString('base64');
	const styleNonce = randomBytes(18).toString('base64');
	const csp = [
		"default-src 'none'",
		'img-src data:',
		`style-src 'nonce-${styleNonce}'`,
		`script-src 'nonce-${scriptNonce}'`,
	].join('; ');
	const viewState = toLoginAssistantViewState(snapshot);
	const qrImage = viewState.qrImage
		? `<img class="qr" alt="小红书官方登录二维码" src="data:image/png;base64,${viewState.qrImage}">`
		: '<div class="qr-placeholder">暂未检测到二维码，请等待页面加载或刷新二维码。</div>';
	const canRefresh = viewState.status === 'expired' || !viewState.qrImage;
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<title>小红书扫码登录</title>
	<style nonce="${styleNonce}">
		:root { color-scheme: light dark; }
		body { max-width: 560px; margin: 0 auto; padding: 24px; color: var(--vscode-foreground); font: 14px/1.7 var(--vscode-font-family); }
		h1 { font-size: 20px; }
		.status { color: var(--vscode-descriptionForeground); }
		.qr-wrap { display: grid; place-items: center; min-height: 280px; margin: 20px 0; padding: 16px; background: white; border-radius: 8px; }
		.qr { width: min(100%, 280px); height: auto; image-rendering: auto; }
		.qr-placeholder { max-width: 280px; color: #333; text-align: center; }
		.actions { display: flex; gap: 8px; }
		button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; padding: 6px 12px; cursor: pointer; }
		button:disabled { opacity: .55; cursor: default; }
		.notice { font-size: 12px; color: var(--vscode-descriptionForeground); }
	</style>
</head>
<body>
	<h1>小红书扫码登录</h1>
	<p class="status" id="status">${escapeHtml(viewState.message)}</p>
	<p class="notice" id="countdown"></p>
	<div class="qr-wrap" id="qr-wrap">${qrImage}</div>
	<div class="actions">
		<button id="refresh"${canRefresh ? '' : ' disabled'}>刷新二维码</button>
		<button id="close">关闭</button>
	</div>
	<p class="notice">请使用小红书手机客户端扫码并确认。若页面要求其他验证，请停止此流程并稍后重试；本扩展不会自动处理验证码。</p>
	<script nonce="${scriptNonce}">
		const vscode = acquireVsCodeApi();
		let expiresAt = ${viewState.expiresAt};
		let currentStatus = '${escapeHtml(viewState.status)}';
		const updateCountdown = () => {
			const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
			document.getElementById('countdown').textContent = expiresAt ? (remaining ? '二维码有效期约 ' + remaining + ' 秒' : '二维码可能已过期') : '';
		};
		updateCountdown();
		setInterval(updateCountdown, 1000);
		document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh-qr' }));
		document.getElementById('close').addEventListener('click', () => vscode.postMessage({ command: 'close' }));
		vscode.postMessage({ command: 'ready' });
		window.addEventListener('message', event => {
			const data = event.data;
			if (!data || typeof data.message !== 'string' || typeof data.status !== 'string' || typeof data.expiresAt !== 'number') return;
			currentStatus = data.status;
			expiresAt = data.expiresAt;
			updateCountdown();
			document.getElementById('status').textContent = data.message;
			const refresh = document.getElementById('refresh');
			refresh.disabled = currentStatus !== 'expired' && Boolean(data.qrImage);
			const wrap = document.getElementById('qr-wrap');
			wrap.replaceChildren();
			if (typeof data.qrImage === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.qrImage) && data.qrImage.length <= 1400000) {
				const image = document.createElement('img');
				image.className = 'qr';
				image.alt = '小红书官方登录二维码';
				image.src = 'data:image/png;base64,' + data.qrImage;
				wrap.append(image);
			} else {
				const placeholder = document.createElement('div');
				placeholder.className = 'qr-placeholder';
				placeholder.textContent = '暂未检测到二维码，请等待页面加载或刷新二维码。';
				wrap.append(placeholder);
			}
		});
	</script>
</body>
</html>`;
}
