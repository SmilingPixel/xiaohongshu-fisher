import { SourceError } from '../models/source-error';
import { browserModeLabel, type ResolvedBrowserMode } from './browser-mode';

type BrowserStartupCategory = 'runtime-missing' | 'dependencies' | 'display' | 'sandbox' | 'profile-in-use' | 'permissions' | 'unknown';

export interface BrowserStartupFailure {
	readonly category: BrowserStartupCategory;
	readonly missingLibraries: readonly string[];
	readonly error: SourceError;
}

/** Converts Playwright launch failures into actionable messages and safe diagnostic metadata. */
export function diagnoseBrowserStartup(error: unknown, mode: ResolvedBrowserMode): BrowserStartupFailure {
	// Raw browser logs contain launch arguments and profile paths. Inspect them locally,
	// but expose only known categories and library basenames to logs and views.
	const reason = error instanceof Error ? error.message.replace(/\x1b\[[0-9;]*m/g, '') : '';
	let category: BrowserStartupCategory = 'unknown';
	let detail = '请查看“输出”中的 Xiaohongshu Fisher 启动诊断，并参考 README 中的浏览器故障排查说明。';
	const missingLibraries = new Set<string>();

	if (/Executable doesn't exist/i.test(reason)) {
		category = 'runtime-missing';
		detail = '缺少当前模式所需的 Playwright Chromium 运行时，请运行“安装 Playwright Chromium”后重试。';
	} else if (/Host system is missing dependencies|Missing libraries:|error while loading shared libraries:/i.test(reason)) {
		category = 'dependencies';
		for (const match of reason.matchAll(/error while loading shared libraries:\s*(lib[A-Za-z0-9_+.-]{1,100}\.so(?:\.\d+)*)\s*:/g)) {
			missingLibraries.add(match[1]);
		}
		const libraryList = reason.split(/Missing libraries:/i)[1]?.split(/\r?\n/) ?? [];
		for (const line of libraryList) {
			const entry = line.replace(/^[\s║│]+|[\s║│]+$/g, '');
			const match = entry.match(/^(lib[A-Za-z0-9_+.-]{1,100}\.so(?:\.\d+)*)$/);
			if (match) {missingLibraries.add(match[1]);}
			else if (entry) {break;}
		}
		const libraries = [...missingLibraries].slice(0, 20);
		detail = `缺少 Chromium 系统依赖${libraries.length ? `（${libraries.join('、')}）` : ''}。请在运行扩展的主机上运行“安装 Playwright Chromium”（Linux 下会安装系统依赖，可能需要 sudo 权限），完成后重试。`;
	} else if (/Missing X server or \$DISPLAY|cannot open display|Unable to open X display|without having a XServer running/i.test(reason)) {
		category = 'display';
		detail = '当前环境没有可用的图形显示，请检查 DISPLAY/Wayland；无图形环境可将 xiaohongshu-fisher.browserMode 设置为 headless 后重新加载 VS Code 窗口。';
	} else if (/No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|SUID sandbox helper binary|sandboxing failed/i.test(reason)) {
		category = 'sandbox';
		detail = 'Chromium 沙箱初始化失败，请检查运行扩展的主机或容器的用户命名空间与沙箱权限。';
	} else if ((error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM')) || /Permission denied|spawn .* EACCES/i.test(reason)) {
		category = 'permissions';
		detail = '运行扩展的用户没有浏览器执行权限或会话目录读写权限，请检查扩展存储目录和浏览器安装目录的权限。';
	} else if (/ProcessSingleton|profile appears to be in use|user data directory is already in use/i.test(reason)) {
		category = 'profile-in-use';
		detail = '扩展的浏览器会话目录正被占用，请关闭其他使用此会话的浏览器或 VS Code 窗口后重试。';
	}

	const code = category === 'runtime-missing' ? 'browser-missing' : category === 'dependencies' ? 'browser-dependencies' : 'browser-startup';
	return {
		category,
		missingLibraries: [...missingLibraries].slice(0, 20),
		error: new SourceError(code, `无法启动${browserModeLabel(mode)} Chromium。${detail}`, false),
	};
}
