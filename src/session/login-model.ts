export type LoginStatus =
	| 'loading'
	| 'waiting-scan'
	| 'verifying-session'
	| 'qr-unavailable'
	| 'access-restricted'
	| 'page-error'
	| 'logged-in'
	| 'expired'
	| 'verification-required';

export interface LoginSnapshot {
	readonly status: LoginStatus;
	readonly message: string;
	readonly qrPng?: Uint8Array;
	readonly qrRevision: number;
	readonly expiresAt: number;
	readonly pageUrl?: string;
}

export const LOGIN_TERMINAL_STATES = new Set<LoginStatus>([
	'logged-in', 'expired', 'qr-unavailable', 'access-restricted', 'page-error', 'verification-required',
]);
