import * as l10n from '@vscode/l10n';
import { classifyOfficialErrorRedirect } from '../sources/official-page-error';
import type { LoginStatus } from './login-model';
export type { LoginStatus } from './login-model';

export interface LoginDetectionInput {
	readonly url: string;
	readonly bodyText: string;
	readonly hasQr: boolean;
	readonly authenticated?: boolean;
	readonly now: number;
	readonly expiresAt: number;
	readonly officialExpired?: boolean;
}
export interface LoginDetection {
	readonly status: LoginStatus;
	readonly message: string;
}

const VERIFICATION_TEXT = /滑块|拖动验证|请完成验证|人机验证|安全验证|身份验证|captcha|robot/i;
const EXPIRED_TEXT = /二维码.{0,8}(失效|过期)|请刷新二维码|重新获取二维码/;

/** A session cookie can represent a guest; require the official account response. */
export function isAuthenticatedUserResponse(value: unknown): boolean {
	const response = value as {
		success?: unknown;
		code?: unknown;
		data?: { guest?: unknown };
	} | null;
	return response?.success === true && response.code === 0 && response.data?.guest === false;
}

/** Official errors and verification take precedence over authentication and QR expiry evidence. */
export function detectLoginState(input: LoginDetectionInput): LoginDetection {
	const text = input.bodyText.replaceAll(/\s+/g, '');
	if (input.url && !input.url.startsWith('about:blank') && !input.url.startsWith('https://')) {
		return {
			status: 'page-error',
			message: l10n.t(
				'The login page redirected to an unsupported address. Reading has stopped. Check the official page and reopen login.',
			),
		};
	}
	const officialError = classifyOfficialErrorRedirect(input.url);
	if (officialError) {
		return {
			status: officialError.kind === 'ip-risk' ? 'access-restricted' : 'page-error',
			message: officialError.message,
		};
	}
	if (VERIFICATION_TEXT.test(text)) {
		return {
			status: 'verification-required',
			message: l10n.t(
				'Xiaohongshu requires manual security verification. Login has paused. This extension only supports QR login and cannot handle other verification. Please retry login later.',
			),
		};
	}
	if (input.authenticated) {
		return {
			status: 'logged-in',
			message: l10n.t('Logged in. Return to the list and refresh the content.'),
		};
	}
	if (
		input.officialExpired ||
		(input.expiresAt > 0 && input.now >= input.expiresAt) ||
		EXPIRED_TEXT.test(text)
	) {
		return {
			status: 'expired',
			message: l10n.t('The QR code has expired. Refresh it and try again.'),
		};
	}
	if (input.hasQr) {
		return {
			status: 'waiting-scan',
			message: l10n.t('Scan the QR code with the Xiaohongshu mobile app and confirm login.'),
		};
	}
	if (/扫码登录|登录|手机号|密码/.test(text)) {
		return { status: 'loading', message: l10n.t('Waiting for the official login QR code…') };
	}
	return {
		status: 'loading',
		message:
			input.url && !input.url.startsWith('about:blank')
				? l10n.t('Reading the official login page…')
				: l10n.t('Opening the official login page…'),
	};
}
