export interface LoginQrChallenge {
	readonly id: string;
	readonly code: string;
	readonly url: string;
	readonly receivedAt: number;
}

export type QrParseFailure =
	'invalid-envelope' | 'invalid-challenge' | 'untrusted-url' | 'unsupported-response';
export type QrParseResult =
	| { readonly ok: true; readonly challenge: LoginQrChallenge }
	| { readonly ok: false; readonly reason: QrParseFailure };

const MAX_FIELD_LENGTH = 128;
const MAX_URL_BYTES = 2_048;
// eslint-disable-next-line no-control-regex -- Reject control bytes before URL parsing can silently strip them.
const URL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Accepts only a bounded official challenge whose URL matches the response identity. */
export function parseLoginQrResponse(input: unknown, receivedAt: number): QrParseResult {
	if (!isRecord(input) || input.code !== 0 || input.success !== true || !isRecord(input.data)) {
		return { ok: false, reason: 'invalid-envelope' };
	}
	const id = input.data.qr_id;
	const code = input.data.code;
	const rawUrl = input.data.url;
	if (!isBoundedString(id) || !isBoundedString(code) || typeof rawUrl !== 'string') {
		return { ok: false, reason: 'invalid-challenge' };
	}
	if (
		new TextEncoder().encode(rawUrl).byteLength > MAX_URL_BYTES ||
		rawUrl !== rawUrl.trim() ||
		URL_CONTROL_CHARACTERS.test(rawUrl) ||
		/%(?![0-9A-Fa-f]{2})/.test(rawUrl)
	) {
		return { ok: false, reason: 'invalid-challenge' };
	}
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, reason: 'untrusted-url' };
	}
	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'www.xiaohongshu.com' ||
		url.port ||
		url.username ||
		url.password ||
		url.hash ||
		url.pathname !== '/mobile/login'
	) {
		return { ok: false, reason: 'untrusted-url' };
	}
	const qrIds = url.searchParams.getAll('qrId');
	const codes = url.searchParams.getAll('xhs_code');
	if (
		qrIds.length !== 1 ||
		codes.length !== 1 ||
		qrIds[0] !== id ||
		codes[0] !== code ||
		!qrIds[0] ||
		!codes[0]
	) {
		return { ok: false, reason: 'invalid-challenge' };
	}
	return { ok: true, challenge: { id, code, url: rawUrl, receivedAt } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}
