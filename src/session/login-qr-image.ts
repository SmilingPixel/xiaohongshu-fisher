const QR_PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodeQrPngBase64(value: string | undefined): Uint8Array | undefined {
	if (!value || value.length > 1_400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {return undefined;}
	const image = Buffer.from(value, 'base64');
	if (image.byteLength > 1_024 * 1_024 || !image.subarray(0, QR_PNG_SIGNATURE.length).equals(QR_PNG_SIGNATURE)) {
		image.fill(0);
		return undefined;
	}
	return image;
}
