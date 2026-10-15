import type { Page, Request, Response } from 'playwright';
import { parseLoginQrResponse, type LoginQrChallenge, type QrParseFailure } from './login-qr';

const ENDPOINT = 'https://edith.xiaohongshu.com/api/sns/web/v1/login/qrcode/create';
const MAX_BODY_BYTES = 64 * 1024;

export type LoginQrObserverFailure = QrParseFailure | 'access-restricted' | 'invalid-json' | 'network';

export interface LoginQrDiagnostics {
	readonly requestStarted: boolean;
	readonly responseReceived: boolean;
	readonly failure?: LoginQrObserverFailure;
}

/** Observes only the page-owned official QR creation response. */
export class LoginQrObserver {
	private disposed = false;
	private requestStarted = false;
	private responseReceived = false;
	private failure?: LoginQrObserverFailure;
	private readonly requestHandler = (request: Request): void => {
		if (this.isQrRequest(request)) {this.requestStarted = true;}
	};
	private readonly requestFailedHandler = (request: Request): void => {
		if (this.isQrRequest(request)) {this.reportFailure('network');}
	};
	private readonly responseHandler = (response: Response): void => { void this.handleResponse(response); };

	constructor(private readonly page: Page, private readonly onChallenge: (challenge: LoginQrChallenge) => void, private readonly onFailure: (failure: LoginQrObserverFailure) => void) {
		page.on('response', this.responseHandler);
		page.on('request', this.requestHandler);
		page.on('requestfailed', this.requestFailedHandler);
	}

	getDiagnostics(): LoginQrDiagnostics { return { requestStarted: this.requestStarted, responseReceived: this.responseReceived, failure: this.failure }; }

	dispose(): void {
		if (this.disposed) {return;}
		this.disposed = true;
		this.page.off('response', this.responseHandler);
		this.page.off('request', this.requestHandler);
		this.page.off('requestfailed', this.requestFailedHandler);
	}

	private isQrRequest(request: Request): boolean {
		if (this.disposed || request.url() !== ENDPOINT || request.method() !== 'POST') {return false;}
		try {
			return request.frame() === this.page.mainFrame();
		} catch { return false; }
	}

	private reportFailure(failure: LoginQrObserverFailure): void {
		if (this.disposed) {return;}
		this.failure = failure;
		this.onFailure(failure);
	}

	private async handleResponse(response: Response): Promise<void> {
		if (!this.isQrRequest(response.request())) {return;}
		this.requestStarted = true;
		this.responseReceived = true;
		if (response.status() >= 400) { this.reportFailure(response.status() === 403 || response.status() === 429 ? 'access-restricted' : 'network'); return; }
		const headers = response.headers();
		if (!/application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) {this.reportFailure('unsupported-response'); return;}
		const declared = Number(headers['content-length']);
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {this.reportFailure('unsupported-response'); return;}
		let body: Buffer;
		try { body = await response.body(); } catch { this.reportFailure('network'); return; }
		if (this.disposed) {return;}
		if (body.byteLength > MAX_BODY_BYTES) {this.reportFailure('unsupported-response'); return;}
		let value: unknown;
		try { value = JSON.parse(body.toString('utf8')) as unknown; } catch {this.reportFailure('invalid-json'); return;}
		const parsed = parseLoginQrResponse(value, Date.now());
		if (parsed.ok) {this.failure = undefined; this.onChallenge(parsed.challenge);}
		else {this.reportFailure(parsed.reason);}
	}
}
