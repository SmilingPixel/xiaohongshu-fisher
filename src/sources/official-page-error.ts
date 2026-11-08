import * as l10n from '@vscode/l10n';
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
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.port ||
		!OFFICIAL_HOST.test(url.hostname) ||
		!ERROR_PATH.test(url.pathname)
	) {
		return undefined;
	}
	const values = url.searchParams.getAll('error_code');
	const platformCode =
		values.length === 1 && /^[0-9]{1,6}$/.test(values[0]) ? values[0] : undefined;
	if (platformCode === '300012') {
		return {
			kind: 'ip-risk',
			platformCode,
			message: l10n.t(
				'Xiaohongshu reported an IP risk on the current network (300012). The operation has stopped. Check the network of the extension host, follow the official instructions, and retry manually.',
			),
		};
	}
	return {
		kind: 'official-error-page',
		platformCode,
		message: platformCode
			? l10n.t(
					'Xiaohongshu returned an error page (code: {code}). The operation has stopped. Follow the official page instructions and retry manually.',
					{ code: platformCode },
				)
			: l10n.t(
					'Xiaohongshu returned an error page. The operation cannot be completed. Follow the official page instructions and retry manually.',
				),
	};
}

export function officialPageErrorSourceCode(
	error: OfficialPageError,
): 'access-restricted' | 'page-error' {
	return error.kind === 'ip-risk' ? 'access-restricted' : 'page-error';
}
