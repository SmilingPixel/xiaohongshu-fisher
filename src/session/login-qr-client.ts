import type { APIResponse, Page, Request, Route } from 'playwright';
import { parseLoginQrResponse, type LoginQrChallenge, type QrParseFailure } from './login-qr';

const CREATE_ENDPOINT = 'https://edith.xiaohongshu.com/api/sns/web/v1/login/qrcode/create';
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT = 15_000;

export interface LoginQrFailure {
	readonly reason: QrParseFailure | 'request-rejected' | 'invalid-json' | 'network' | 'timeout';
	readonly httpStatus?: number;
}

export interface LoginQrDiagnostics {
	readonly requestSent: boolean;
	readonly responseReceived: boolean;
	readonly failure?: LoginQrFailure['reason'];
}

/**
 * Lets the official page prepare the current session and request signature, then
 * sends the create request through the extension's HTTP client. Returning that
 * same response to the page keeps its QR polling bound to the displayed challenge.
 */
export class LoginQrClient {
	private disposed = false;
	private inFlight = false;
	private requestSent = false;
	private responseReceived = false;
	private failure?: LoginQrFailure['reason'];
	private readonly routeHandler = (route: Route): Promise<void> => this.create(route);

	constructor(
		private readonly page: Page,
		private readonly onChallenge: (challenge: LoginQrChallenge) => void,
		private readonly onFailure: (failure: LoginQrFailure) => void,
	) {}

	async install(): Promise<void> {
		await this.page.route(CREATE_ENDPOINT, this.routeHandler);
		if (this.disposed) {await this.page.unroute(CREATE_ENDPOINT, this.routeHandler);}
	}

	getDiagnostics(): LoginQrDiagnostics {
		return { requestSent: this.requestSent, responseReceived: this.responseReceived, failure: this.failure };
	}

	dispose(): void {
		if (this.disposed) {return;}
		this.disposed = true;
		void this.page.unroute(CREATE_ENDPOINT, this.routeHandler).catch(() => undefined);
	}

	private isPreparedCreateRequest(request: Request): boolean {
		if (request.url() !== CREATE_ENDPOINT || request.method() !== 'POST') {return false;}
		try { return request.frame() === this.page.mainFrame(); } catch { return false; }
	}

	private reportFailure(failure: LoginQrFailure): void {
		if (this.disposed) {return;}
		this.failure = failure.reason;
		this.onFailure(failure);
	}

	private async create(route: Route): Promise<void> {
		const request = route.request();
		if (this.disposed || this.inFlight) {await route.abort().catch(() => undefined); return;}
		if (!this.isPreparedCreateRequest(request)) {await route.fallback().catch(() => undefined); return;}
		this.inFlight = true;
		let response: APIResponse | undefined;
		try {
			this.requestSent = true;
			// Preserve the signed body and headers verbatim in memory. This client shares
			// the browser cookie jar, so response cookies also belong to the login session.
			// Never replay the request through the browser or follow an API redirect.
			response = await this.page.context().request.fetch(request, {
				timeout: REQUEST_TIMEOUT, maxRedirects: 0, maxRetries: 0,
			});
			if (this.disposed) {await route.abort().catch(() => undefined); return;}
			this.responseReceived = true;
			if (!response.ok()) {
				await route.abort().catch(() => undefined);
				this.reportFailure({ reason: 'request-rejected', httpStatus: response.status() });
				return;
			}
			const headers = response.headers();
			if (!/application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '') || Number(headers['content-length']) > MAX_BODY_BYTES) {
				await route.abort().catch(() => undefined);
				this.reportFailure({ reason: 'unsupported-response' });
				return;
			}
			const body = await response.body();
			if (this.disposed) {await route.abort().catch(() => undefined); return;}
			if (body.byteLength > MAX_BODY_BYTES) {
				await route.abort().catch(() => undefined);
				this.reportFailure({ reason: 'unsupported-response' });
				return;
			}
			let value: unknown;
			try { value = JSON.parse(body.toString('utf8')) as unknown; } catch {
				await route.abort().catch(() => undefined);
				this.reportFailure({ reason: 'invalid-json' });
				return;
			}
			const parsed = parseLoginQrResponse(value, Date.now());
			if (!parsed.ok) {
				await route.abort().catch(() => undefined);
				this.reportFailure({ reason: parsed.reason });
				return;
			}
			await route.fulfill({ response });
			if (this.disposed) {return;}
			this.failure = undefined;
			this.onChallenge(parsed.challenge);
		} catch (error) {
			await route.abort().catch(() => undefined);
			this.reportFailure({ reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network' });
		} finally {
			await response?.dispose().catch(() => undefined);
			this.inFlight = false;
		}
	}
}
