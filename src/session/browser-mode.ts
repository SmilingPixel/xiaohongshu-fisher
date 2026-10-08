export type BrowserMode = 'auto' | 'visible' | 'headless';
export type ResolvedBrowserMode = Exclude<BrowserMode, 'auto'>;

export interface BrowserEnvironment {
	readonly display?: string;
	readonly waylandDisplay?: string;
}

export function isBrowserMode(value: unknown): value is BrowserMode {
	return value === 'auto' || value === 'visible' || value === 'headless';
}

export function normalizeBrowserMode(value: unknown): BrowserMode {
	return isBrowserMode(value) ? value : 'auto';
}

export function resolveBrowserMode(mode: BrowserMode, environment: BrowserEnvironment): ResolvedBrowserMode {
	if (mode !== 'auto') {return mode;}
	return environment.display || environment.waylandDisplay ? 'visible' : 'headless';
}

export function browserModeLabel(mode: ResolvedBrowserMode): string {
	return mode === 'visible' ? '可见' : '无头';
}
