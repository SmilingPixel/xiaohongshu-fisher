import { format } from 'node:util';

/**
 * Applies Node's printf-style formatting before writing to a VS Code log channel.
 * LogOutputChannel accepts variadic values but does not replace `%s`/`%d`
 * placeholders in the message itself.
 */
export function formatLogMessage(message: string, args: readonly unknown[]): string {
	return format(message, ...args);
}
