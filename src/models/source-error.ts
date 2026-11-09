import * as l10n from '@vscode/l10n';
export type SourceErrorCode =
	| 'invalid-query'
	| 'unauthenticated'
	| 'access-restricted'
	| 'page-error'
	| 'browser-missing'
	| 'browser-dependencies'
	| 'browser-startup'
	| 'network'
	| 'parse-failure'
	| 'not-found'
	| 'unknown';

export class SourceError extends Error {
	constructor(
		readonly code: SourceErrorCode,
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = 'SourceError';
	}
}

export function toSourceError(error: unknown): SourceError {
	if (error instanceof SourceError) {
		return error;
	}
	if (error instanceof Error && error.name === 'AbortError') {
		return new SourceError('unknown', l10n.t('The request was cancelled.'), false);
	}
	return new SourceError(
		'unknown',
		l10n.t('Unable to load content. Please try again later.'),
		true,
	);
}
