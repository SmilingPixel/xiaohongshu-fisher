import { isValidQrPng } from './login-qr-renderer';

export function validateQrPng(value: Uint8Array | undefined): Uint8Array | undefined {
	if (!isValidQrPng(value)) {return undefined;}
	return Uint8Array.from(value);
}
