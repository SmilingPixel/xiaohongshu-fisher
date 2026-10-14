import type { Page, Response } from 'playwright';
import { parseLoginQrResponse, type LoginQrChallenge, type QrParseFailure } from './login-qr';

const ENDPOINT = 'https://edith.xiaohongshu.com/api/sns/web/v1/login/qrcode/create';
const MAX_BODY_BYTES = 64 * 1024;

export type LoginQrObserverFailure = QrParseFailure | 'access-restricted' | 'invalid-json' | 'network';

/** Observes only the page-owned official QR creation response. */
export class LoginQrObserver {
	private disposed = false;
	private readonly responseHandler = (response: Response): void => { void this.handleResponse(response); };

	constructor(private readonly page: Page, private readonly onChallenge: (challenge: LoginQrChallenge) => void, private readonly onFailure: (failure: LoginQrObserverFailure) => void) {
		page.on('response', this.responseHandler);
	}

	dispose(): void {
		if (this.disposed) {return;}
		this.disposed = true;
		this.page.off('response', this.responseHandler);
	}

	private async handleResponse(response: Response): Promise<void> {
		if (this.disposed || response.url() !== ENDPOINT || response.request().method() !== 'POST') {return;}
		const request = response.request();
		try {
			if (request.frame() !== this.page.mainFrame()) {return;}
		} catch { return; }
		if (response.status() >= 400) { this.onFailure(response.status() === 403 || response.status() === 429 ? 'access-restricted' : 'network'); return; }
		const headers = response.headers();
		if (!/application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) {this.onFailure('unsupported-response'); return;}
		const declared = Number(headers['content-length']);
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {this.onFailure('unsupported-response'); return;}
		let body: Buffer;
		try { body = await response.body(); } catch { this.onFailure('network'); return; }
		if (this.disposed || body.byteLength > MAX_BODY_BYTES) {this.onFailure('unsupported-response'); return;}
		let value: unknown;
		try { value = JSON.parse(body.toString('utf8')) as unknown; } catch {this.onFailure('invalid-json'); return;}
		const parsed = parseLoginQrResponse(value, Date.now());
		if (parsed.ok) {this.onChallenge(parsed.challenge);}
		else {this.onFailure(parsed.reason);}
	}
}
