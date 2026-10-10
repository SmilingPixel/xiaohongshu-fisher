export type SourceErrorCode =
	| 'invalid-query'
	| 'unauthenticated'
	| 'access-restricted'
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
		readonly retryable: boolean
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
		return new SourceError('unknown', '请求已取消。', false);
	}
	return new SourceError('unknown', '暂时无法加载内容，请稍后重试。', true);
}
