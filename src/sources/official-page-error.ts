export type OfficialPageErrorKind = 'ip-risk' | 'official-error-page';

export interface OfficialPageError {
	readonly kind: OfficialPageErrorKind;
	readonly platformCode?: string;
	readonly message: string;
}

const OFFICIAL_HOST = /(?:^|\.)xiaohongshu\.com$/i;
const ERROR_PATH = /^\/website-login\/error\/?$/;

/**
 * Classifies only the official login error route. Query values other than one
 * bounded numeric error code are deliberately ignored so remote text cannot
 * become an instruction or leak into diagnostics.
 */
export function classifyOfficialErrorRedirect(value: string): OfficialPageError | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port || !OFFICIAL_HOST.test(url.hostname) || !ERROR_PATH.test(url.pathname)) {
		return undefined;
	}
	const values = url.searchParams.getAll('error_code');
	const platformCode = values.length === 1 && /^[0-9]{1,6}$/.test(values[0]) ? values[0] : undefined;
	if (platformCode === '300012') {
		return {
			kind: 'ip-risk',
			platformCode,
			message: '小红书提示当前网络存在 IP 风险（300012），已停止本次操作。请检查运行扩展的主机所使用的网络，按官方提示处理后手动重试。',
		};
	}
	return {
		kind: 'official-error-page',
		platformCode,
		message: platformCode
			? `小红书返回了错误页（错误码：${platformCode}），已停止本次操作。请在官方页面查看提示，处理后手动重试。`
			: '小红书返回了错误页，暂时无法完成本次操作。请在官方页面查看提示，处理后手动重试。',
	};
}

export function officialPageErrorSourceCode(error: OfficialPageError): 'access-restricted' | 'page-error' {
	return error.kind === 'ip-risk' ? 'access-restricted' : 'page-error';
}
