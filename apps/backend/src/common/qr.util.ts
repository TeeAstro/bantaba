import * as QRCode from 'qrcode';

// Renders a QR code as SVG markup encoding the given raw token. Used
// exactly once per ticket, at mint time (PaymentsService.completeOrder),
// while the raw token is still in memory — see docs/checkin.md for why
// the rendered image, not the token, is what gets persisted.
//
// SVG rather than PNG: it's plain text (cheap to store in a DB column,
// no binary/base64 overhead) and scales cleanly on any screen size
// without a fixed pixel resolution to pick.
export async function generateQrCodeSvg(rawToken: string): Promise<string> {
  return QRCode.toString(rawToken, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
  });
}
