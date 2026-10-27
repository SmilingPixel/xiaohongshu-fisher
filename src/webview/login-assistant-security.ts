import { randomBytes } from 'node:crypto';
import {
	LOGIN_TERMINAL_STATES,
	type LoginSnapshot,
	type LoginStatus,
} from '../session/login-model';

const OFFICIAL_HOME_URL = 'https://www.xiaohongshu.com/';

export type LoginAssistantMessage =
	| { command: 'ready' }
	| { command: 'refresh-qr' }
	| { command: 'open-official-page' }
	| { command: 'close' };

export function isLoginAssistantMessage(value: unknown): value is LoginAssistantMessage {
	if (typeof value !== 'object' || value === null || !('command' in value)) {
		return false;
	}
	const message = value as { command?: unknown };
	const keys = Object.keys(message);
	return (
		keys.length === 1 &&
		keys[0] === 'command' &&
		(message.command === 'ready' ||
			message.command === 'refresh-qr' ||
			message.command === 'open-official-page' ||
			message.command === 'close')
	);
}

export interface LoginAssistantViewState {
	status: LoginStatus;
	message: string;
	qrAvailable: boolean;
	qrImageUri?: string;
	expiresAt: number;
	pageUrl?: string;
}

/** QR bytes stay out of messages; only a host-created WebView resource URI can display the image. */
export function toLoginAssistantViewState(
	snapshot: LoginSnapshot,
	qrImageUri?: string,
): LoginAssistantViewState {
	const terminal = LOGIN_TERMINAL_STATES.has(snapshot.status);
	const qrAvailable = !terminal && snapshot.status === 'waiting-scan' && Boolean(snapshot.qrPng);

	return {
		status: snapshot.status,
		message: snapshot.message.slice(0, 500),
		qrAvailable,
		qrImageUri: qrAvailable ? qrImageUri : undefined,
		expiresAt: !terminal && Number.isFinite(snapshot.expiresAt) ? snapshot.expiresAt : 0,
		pageUrl:
			terminal && (snapshot.status === 'access-restricted' || snapshot.status === 'page-error')
				? OFFICIAL_HOME_URL
				: undefined,
	};
}

function escapeHtml(value: string): string {
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

export function renderLoginAssistantHtml(snapshot: LoginSnapshot, cspSource: string): string {
	const scriptNonce = randomBytes(18).toString('base64');
	const styleNonce = randomBytes(18).toString('base64');
	const csp = [
		"default-src 'none'",
		`img-src ${cspSource}`,
		`style-src 'nonce-${styleNonce}'`,
		`script-src 'nonce-${scriptNonce}'`,
	].join('; ');
	const viewState = toLoginAssistantViewState(snapshot);
	const terminal = LOGIN_TERMINAL_STATES.has(viewState.status);
	const requiresManualRetry =
		viewState.status === 'access-restricted' ||
		viewState.status === 'page-error' ||
		viewState.status === 'verification-required';
	const canRefresh = terminal && viewState.status !== 'logged-in';
	const retryLabel = requiresManualRetry ? '重新尝试登录' : '刷新二维码';
	return /* HTML */ `<!DOCTYPE html>
		<html lang="zh-CN">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<meta http-equiv="Content-Security-Policy" content="${csp}" />
				<title>小红书扫码登录</title>
				<style nonce="${styleNonce}">
					:root {
						color-scheme: light dark;
					}
					body {
						max-width: 560px;
						margin: 0 auto;
						padding: 24px;
						color: var(--vscode-foreground);
						font: 14px/1.7 var(--vscode-font-family);
					}
					h1 {
						font-size: 20px;
					}
					.status {
						color: var(--vscode-descriptionForeground);
					}
					.qr-stage {
						min-height: 280px;
						display: grid;
						place-items: center;
						margin: 24px 0;
						text-align: center;
					}
					#qr-image {
						width: 280px;
						max-width: 100%;
						height: auto;
						background: white;
					}
					.actions {
						display: flex;
						flex-wrap: wrap;
						gap: 8px;
					}
					button {
						color: var(--vscode-button-foreground);
						background: var(--vscode-button-background);
						border: 0;
						border-radius: 2px;
						padding: 6px 12px;
						cursor: pointer;
					}
					button:disabled {
						opacity: 0.55;
						cursor: default;
					}
					.notice {
						font-size: 12px;
						color: var(--vscode-descriptionForeground);
					}
					a {
						color: var(--vscode-textLink-foreground);
					}
				</style>
			</head>
			<body>
				<h1>小红书扫码登录</h1>
				<p class="status" id="status" role="status" aria-live="polite">
					${escapeHtml(viewState.message)}
				</p>
				<div class="qr-stage">
					<img
						id="qr-image"
						alt="小红书登录二维码，请使用小红书 App 扫码"
						width="280"
						height="280"
						hidden
					/>
					<p class="notice" id="qr-placeholder">正在获取二维码…</p>
				</div>
				<p class="notice" id="official-link" ${viewState.pageUrl ? '' : ' hidden'}>
					<a href="#">在浏览器中查看官方页面</a>（外部浏览器操作不会同步到扩展会话）
				</p>
				<p class="notice" id="countdown"></p>
				<div class="actions">
					<button id="refresh" ${canRefresh ? '' : ' disabled'}>${retryLabel}</button>
					<button id="close">关闭</button>
				</div>
				<p class="notice">
					请使用小红书手机客户端扫码并确认。若页面要求其他验证，请停止此流程并稍后重试；本扩展不会自动处理验证码。
				</p>
				<script nonce="${scriptNonce}">
					const vscode = acquireVsCodeApi();
					let expiresAt = ${viewState.expiresAt};
					let currentStatus = '${escapeHtml(viewState.status)}';
					let attemptInFlight = true;
					let qrImageUri;
					const qrImage = document.getElementById('qr-image');
					const placeholder = document.getElementById('qr-placeholder');
					const refresh = document.getElementById('refresh');
					const updateDisplay = () => {
						const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
						const locallyExpired = expiresAt > 0 && remaining === 0;
						const showQr =
							currentStatus === 'waiting-scan' && Boolean(qrImageUri) && !locallyExpired;
						qrImage.hidden = !showQr;
						placeholder.hidden = showQr;
						if (showQr) {
							if (qrImage.getAttribute('src') !== qrImageUri) {
								qrImage.src = qrImageUri;
							}
						} else {
							qrImage.removeAttribute('src');
						}
						const requiresManualRetry =
							currentStatus === 'access-restricted' ||
							currentStatus === 'page-error' ||
							currentStatus === 'verification-required';
						refresh.hidden = currentStatus === 'logged-in';
						refresh.disabled =
							attemptInFlight ||
							!(
								requiresManualRetry ||
								locallyExpired ||
								currentStatus === 'expired' ||
								currentStatus === 'qr-unavailable'
							);
						refresh.textContent = requiresManualRetry ? '重新尝试登录' : '刷新二维码';
						let countdown = '';
						if (expiresAt && !locallyExpired) {
							countdown = '二维码有效期约 ' + remaining + ' 秒';
						}
						if (locallyExpired || currentStatus === 'expired') {
							placeholder.textContent = '二维码已过期，请刷新二维码。';
						} else if (currentStatus === 'logged-in') {
							placeholder.textContent = '登录成功，可以返回列表刷新内容。';
						} else if (currentStatus === 'loading') {
							placeholder.textContent = '正在获取二维码…';
						} else if (currentStatus === 'verifying-session') {
							placeholder.textContent = '正在确认登录状态…';
						} else {
							placeholder.textContent = '二维码暂不可用，请按上方提示操作。';
						}
						document.getElementById('countdown').textContent = countdown;
						document.getElementById('close').textContent =
							currentStatus === 'logged-in' ? '完成' : '关闭';
					};
					updateDisplay();
					setInterval(updateDisplay, 1000);
					document
						.getElementById('refresh')
						.addEventListener('click', () => vscode.postMessage({ command: 'refresh-qr' }));
					document
						.getElementById('close')
						.addEventListener('click', () => vscode.postMessage({ command: 'close' }));
					document.querySelector('#official-link a').addEventListener('click', (event) => {
						event.preventDefault();
						vscode.postMessage({ command: 'open-official-page' });
					});
					window.addEventListener('message', (event) => {
						const data = event.data;
						if (
							!data ||
							typeof data.message !== 'string' ||
							typeof data.status !== 'string' ||
							typeof data.expiresAt !== 'number' ||
							typeof data.qrAvailable !== 'boolean' ||
							typeof data.attemptInFlight !== 'boolean'
						) {
							return;
						}
						currentStatus = data.status;
						expiresAt = Number.isFinite(data.expiresAt) ? data.expiresAt : 0;
						attemptInFlight = data.attemptInFlight;
						qrImageUri =
							data.qrAvailable && typeof data.qrImageUri === 'string' ? data.qrImageUri : undefined;
						updateDisplay();
						document.getElementById('status').textContent = data.message;
						const officialLink = document.getElementById('official-link');
						officialLink.hidden =
							!(currentStatus === 'access-restricted' || currentStatus === 'page-error') ||
							typeof data.pageUrl !== 'string' ||
							!data.pageUrl.startsWith('https://');
					});
					vscode.postMessage({ command: 'ready' });
				</script>
			</body>
		</html>`;
}
