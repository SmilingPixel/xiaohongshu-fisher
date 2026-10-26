export const IMAGE_HOSTS = ['xhscdn.com', 'xiaohongshu.com'];

/** Shared by normalization and rendering so an unusable candidate cannot hide a valid image. */
export function trustedImageUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password || url.port) {
			return undefined;
		}
		const allowed = IMAGE_HOSTS.some(
			(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
		);
		return allowed ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** Official page state can use HTTP or protocol-relative CDN URLs; emit only trusted HTTPS. */
export function normalizeImageUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	try {
		const url = new URL(value.startsWith('//') ? `https:${value}` : value);
		if (url.protocol === 'http:') {
			url.protocol = 'https:';
		}
		return trustedImageUrl(url.toString());
	} catch {
		return undefined;
	}
}
