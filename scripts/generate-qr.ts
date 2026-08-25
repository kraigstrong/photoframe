/**
 * Generates printable QR codes for the canonical production URL.
 *
 * Usage:
 *   npm run generate:qr -- --url https://event.example.com
 *   npm run generate:qr -- --url http://localhost:5173 --allow-insecure
 *
 * Outputs an SVG (scalable, for print) and a PNG (for quick previews) into
 * `qr/`. Do not generate the final QR until the canonical URL is known.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';

const OUT_DIR = 'qr';
/** High error correction survives print imperfection and partial occlusion. */
const ERROR_CORRECTION_LEVEL = 'H' as const;
const PNG_WIDTH = 2048;

export function parseArgs(argv: string[]): { url: string; allowInsecure: boolean } {
  let url: string | undefined;
  let allowInsecure = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') {
      url = argv[i + 1];
      i += 1;
    } else if (arg?.startsWith('--url=')) {
      url = arg.slice('--url='.length);
    } else if (arg === '--allow-insecure') {
      allowInsecure = true;
    }
  }

  if (!url) {
    throw new Error(
      'Missing --url. Example: npm run generate:qr -- --url https://event.example.com',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`--url must be an absolute URL. Received: ${url}`);
  }

  if (parsed.protocol !== 'https:' && !allowInsecure) {
    throw new Error(
      `--url must use HTTPS for a real event. Received: ${parsed.protocol}//. ` +
        'Pass --allow-insecure only for local development.',
    );
  }

  return { url: parsed.toString(), allowInsecure };
}

export async function main(): Promise<void> {
  const { url, allowInsecure } = parseArgs(process.argv.slice(2));

  await mkdir(OUT_DIR, { recursive: true });

  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
    margin: 2,
  });
  const svgPath = join(OUT_DIR, 'event-qr.svg');
  await writeFile(svgPath, svg, 'utf8');

  const pngPath = join(OUT_DIR, 'event-qr.png');
  await QRCode.toFile(pngPath, url, {
    type: 'png',
    errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
    margin: 2,
    width: PNG_WIDTH,
  });

  console.log(`Encoded URL: ${url}`);
  if (allowInsecure) {
    console.log('WARNING: --allow-insecure was used. Do not print this QR for a real event.');
  }
  console.log(`Wrote ${svgPath}`);
  console.log(`Wrote ${pngPath}`);
  console.log('Test the printed QR at its intended size and contrast before the event.');
}

// Only run as a CLI, not when imported (e.g. by tests exercising parseArgs
// or main() directly).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
