import * as l10n from '@vscode/l10n';
import { SourceError } from '../models/source-error';

export type BrowserMode = 'window' | 'headless';
type BrowserStartupCategory =
	| 'runtime-missing'
	| 'dependencies'
	| 'display-unavailable'
	| 'sandbox'
	| 'profile-in-use'
	| 'permissions'
	| 'unknown';

export interface BrowserStartupFailure {
	readonly category: BrowserStartupCategory;
	readonly missingLibraries: readonly string[];
	readonly error: SourceError;
}

/** Converts Playwright launch failures into actionable messages and safe diagnostic metadata. */
export function diagnoseBrowserStartup(
	error: unknown,
	mode: BrowserMode = 'headless',
): BrowserStartupFailure {
	// Raw browser logs contain launch arguments and profile paths. Inspect them locally,
	// but expose only known categories and library basenames to logs and views.
	// eslint-disable-next-line no-control-regex -- Strip actual ANSI escape sequences from Chromium stderr.
	const reason = error instanceof Error ? error.message.replace(/\x1b\[[0-9;]*m/g, '') : '';
	let category: BrowserStartupCategory = 'unknown';
	let detail = l10n.t(
		'Check the Xiaohongshu Fisher startup diagnostics in Output and the browser troubleshooting instructions in the README.',
	);
	const missingLibraries = new Set<string>();
	const browserName = mode === 'headless' ? l10n.t('headless Chromium') : 'Chromium';

	if (/Executable doesn't exist/i.test(reason)) {
		category = 'runtime-missing';
		detail = l10n.t(
			'The {browser} runtime is missing. Run “Install Playwright Chromium” and retry. If already installed, reload the VS Code window.',
			{
				browser:
					mode === 'headless' ? l10n.t('headless Playwright Chromium') : 'Playwright Chromium',
			},
		);
	} else if (
		/Missing X server|\$DISPLAY|cannot open display|Failed to connect to Wayland display|Failed to initialize Wayland/i.test(
			reason,
		)
	) {
		category = 'display-unavailable';
		detail = l10n.t(
			'Window mode requires a graphical desktop. Run the extension on a host with a graphical desktop, or select headless mode in the extension settings. The platform may reject headless sessions.',
		);
	} else if (
		/Host system is missing dependencies|Missing libraries:|error while loading shared libraries:/i.test(
			reason,
		)
	) {
		category = 'dependencies';
		for (const match of reason.matchAll(
			/error while loading shared libraries:\s*(lib[A-Za-z0-9_+.-]{1,100}\.so(?:\.\d+)*)\s*:/g,
		)) {
			missingLibraries.add(match[1]);
		}
		const libraryList = reason.split(/Missing libraries:/i)[1]?.split(/\r?\n/) ?? [];
		for (const line of libraryList) {
			const entry = line.replace(/^[\s║│]+|[\s║│]+$/g, '');
			const match = entry.match(/^(lib[A-Za-z0-9_+.-]{1,100}\.so(?:\.\d+)*)$/);
			if (match) {
				missingLibraries.add(match[1]);
			} else if (entry) {
				break;
			}
		}
		const libraries = [...missingLibraries].slice(0, 20);
		detail = l10n.t(
			'Chromium system dependencies are missing ({libraries}). Run “Install Playwright Chromium” on the extension host and retry. On Linux, this installs system dependencies and may require sudo.',
			{ libraries: libraries.join(', ') || l10n.t('unknown') },
		);
	} else if (
		/No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|SUID sandbox helper binary|sandboxing failed/i.test(
			reason,
		)
	) {
		category = 'sandbox';
		detail = l10n.t(
			'Chromium sandbox initialization failed. Check user namespaces and sandbox permissions on the extension host or container.',
		);
	} else if (
		(error instanceof Error &&
			'code' in error &&
			(error.code === 'EACCES' || error.code === 'EPERM')) ||
		/Permission denied|spawn .* EACCES/i.test(reason)
	) {
		category = 'permissions';
		detail = l10n.t(
			'The extension user cannot execute the browser or access the session directory. Check permissions on the extension storage and browser installation directories.',
		);
	} else if (
		/ProcessSingleton|profile appears to be in use|user data directory is already in use/i.test(
			reason,
		)
	) {
		category = 'profile-in-use';
		detail = l10n.t(
			'The extension browser profile is in use. Close other browsers or VS Code windows using this session and try again.',
		);
	}

	let code: SourceError['code'] = 'browser-startup';
	if (category === 'runtime-missing') {
		code = 'browser-missing';
	} else if (category === 'dependencies') {
		code = 'browser-dependencies';
	}
	return {
		category,
		missingLibraries: [...missingLibraries].slice(0, 20),
		error: new SourceError(
			code,
			l10n.t('Unable to start {browser}. {detail}', { browser: browserName, detail }),
			false,
		),
	};
}
