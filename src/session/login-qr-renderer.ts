import QRCode from 'qrcode';
import type { LoginQrChallenge } from './login-qr';

const MAX_PNG_BYTES = 1_024 * 1_024;
const MAX_DIMENSION = 1_024;

export async function renderLoginQrPng(challenge: LoginQrChallenge): Promise<Uint8Array> {
	const png = await QRCode.toBuffer(challenge.url, {
		type: 'png',
		errorCorrectionLevel: 'M',
		margin: 4,
		scale: 6,
		color: { dark: '#000000FF', light: '#FFFFFFFF' },
	});
	if (!isValidQrPng(png)) {
		throw new Error('QR image exceeded the supported PNG bounds.');
	}
	return Uint8Array.from(png);
}

export function isValidQrPng(value: Uint8Array | undefined): value is Uint8Array {
	if (!value || value.byteLength < 33 || value.byteLength > MAX_PNG_BYTES) {
		return false;
	}
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (!signature.every((byte, index) => value[index] === byte)) {
		return false;
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	let offset = 8;
	let sawHeader = false;
	let sawEnd = false;
	while (offset + 12 <= value.byteLength) {
		const length = view.getUint32(offset);
		const end = offset + 12 + length;
		if (end > value.byteLength) {
			return false;
		}
		const type = String.fromCharCode(...value.subarray(offset + 4, offset + 8));
		if (type === 'IHDR') {
			if (sawHeader || length !== 13) {
				return false;
			}
			const width = view.getUint32(offset + 8);
			const height = view.getUint32(offset + 12);
			if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
				return false;
			}
			sawHeader = true;
		} else if (type === 'IEND') {
			if (length !== 0 || !sawHeader || end !== value.byteLength) {
				return false;
			}
			sawEnd = true;
			break;
		}
		offset = end;
	}
	return sawHeader && sawEnd;
}
