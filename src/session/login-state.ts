export type LoginStatus =
	| 'loading'
	| 'waiting-scan'
	| 'qr-unavailable'
	| 'logged-in'
	| 'expired'
	| 'verification-required';

export interface LoginDetectionInput {
	readonly url: string;
	readonly bodyText: string;
	readonly hasQr: boolean;
	readonly now: number;
	readonly expiresAt: number;
}

export interface LoginDetection {
	readonly status: LoginStatus;
	readonly message: string;
}

const VERIFICATION_TEXT = /滑块|验证码|安全验证|安全限制|身份验证|人机验证|请完成验证|风险|300012|captcha|robot/i;
const EXPIRED_TEXT = /二维码.{0,8}(失效|过期)|请刷新二维码|重新获取二维码/;
const LOGGED_IN_TEXT = /退出登录|我的主页|个人主页|收藏夹|关注列表/;
const LOGIN_TEXT = /扫码登录|登录|手机号|密码/;

export function detectLoginState(input: LoginDetectionInput): LoginDetection {
	const text = input.bodyText.replaceAll(/\s+/g, '');
	if (/\/website-login\/error/i.test(input.url) || VERIFICATION_TEXT.test(text)) {
		return { status: 'verification-required', message: '小红书要求人工完成验证，请在官方页面处理后重试。' };
	}
	if (LOGGED_IN_TEXT.test(text)) {
		return { status: 'logged-in', message: '已登录，可以返回列表刷新内容。' };
	}
	if ((input.expiresAt > 0 && input.now >= input.expiresAt) || EXPIRED_TEXT.test(text)) {
		return { status: 'expired', message: '二维码已过期，请刷新二维码后重试。' };
	}
	if (input.hasQr) {
		return { status: 'waiting-scan', message: '请使用小红书手机客户端扫描二维码并确认登录。' };
	}
	if (LOGIN_TEXT.test(text)) {
		return { status: 'loading', message: '正在等待官方登录二维码…' };
	}
	if (input.url && !input.url.startsWith('about:blank')) {
		return { status: 'loading', message: '正在读取官方登录页面…' };
	}
	return { status: 'loading', message: '正在打开官方登录页面…' };
}
