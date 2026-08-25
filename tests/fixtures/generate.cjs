// Dev-only fixture generator. Not part of the shipped app or its `scripts/`
// (QR generation only). Run with `node tests/fixtures/generate.cjs` if a
// fixture needs to be regenerated or a new one added. See FIXTURES.md for
// the pixel/orientation contract each output file guarantees.
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

// Quadrant-pattern photo fixtures. Colors let a test assert both dimensions
// and orientation-correct content after decode: red is always top-left of
// the *rendered* (orientation-applied) image.
function quadrantCanvas(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const hw = w / 2,
    hh = h / 2;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, hw, hh); // top-left: red
  ctx.fillStyle = '#00b300';
  ctx.fillRect(hw, 0, hw, hh); // top-right: green
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(0, hh, hw, hh); // bottom-left: blue
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(hw, hh, hw, hh); // bottom-right: yellow
  return c;
}

function writeJpeg(name, canvas, quality = 0.92) {
  const buf = canvas.toBuffer('image/jpeg', { quality });
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name, buf.length, 'bytes');
}

// 1. Portrait, no EXIF orientation (implicit orientation = 1).
writeJpeg('portrait.jpg', quadrantCanvas(600, 800));

// 2. Landscape, no EXIF orientation.
writeJpeg('landscape.jpg', quadrantCanvas(800, 600));

// 3. Square.
writeJpeg('square.jpg', quadrantCanvas(700, 700));

// 4. Large photo to exercise downscaling. Smooth gradient compresses tiny
//    despite large pixel dimensions, keeping the fixture small in git.
{
  const w = 4000,
    h = 3000;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#ff0000');
  grad.addColorStop(0.5, '#00b300');
  grad.addColorStop(1, '#0000ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  writeJpeg('oversized-4000x3000.jpg', c, 0.7);
}

// 5. Physically-landscape pixel data (800x600, same layout as landscape.jpg)
//    that must render as portrait (600x800) once EXIF Orientation=6
//    (rotate 90 CW) is respected. Verified rendered quadrant map (Chromium):
//    top-left=blue, top-right=red, bottom-left=yellow, bottom-right=green.
//    See FIXTURES.md.
{
  const raw = quadrantCanvas(800, 600).toBuffer('image/jpeg', { quality: 0.92 });
  const withExif = injectExifOrientation(raw, 6);
  fs.writeFileSync(path.join(OUT, 'exif-rotated-90cw.jpg'), withExif);
  console.log('exif-rotated-90cw.jpg', withExif.length, 'bytes');
}

// 6. Corrupt / non-image fixtures for decode-failure tests.
fs.writeFileSync(path.join(OUT, 'corrupt.jpg'), Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]));
fs.writeFileSync(path.join(OUT, 'not-an-image.txt'), 'this is not an image\n');

function injectExifOrientation(jpegBuffer, orientation) {
  // Minimal TIFF IFD with a single Orientation (0x0112, SHORT) entry.
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  let o = 0;
  tiff.write('II', o);
  o += 2; // little-endian
  tiff.writeUInt16LE(42, o);
  o += 2; // TIFF magic
  tiff.writeUInt32LE(8, o);
  o += 4; // offset to first IFD
  tiff.writeUInt16LE(1, o);
  o += 2; // 1 IFD entry
  tiff.writeUInt16LE(0x0112, o);
  o += 2; // tag: Orientation
  tiff.writeUInt16LE(3, o);
  o += 2; // type: SHORT
  tiff.writeUInt32LE(1, o);
  o += 4; // count: 1
  tiff.writeUInt16LE(orientation, o);
  o += 2;
  tiff.writeUInt16LE(0, o);
  o += 2; // pad SHORT value to 4 bytes
  tiff.writeUInt32LE(0, o);
  o += 4; // next IFD offset: none

  const exifHeader = Buffer.from('Exif\0\0', 'binary');
  const app1Payload = Buffer.concat([exifHeader, tiff]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(app1Payload.length + 2) >> 8, (app1Payload.length + 2) & 0xff]),
    app1Payload,
  ]);

  // Insert immediately after SOI (FF D8).
  const soi = jpegBuffer.subarray(0, 2);
  const rest = jpegBuffer.subarray(2);
  return Buffer.concat([soi, app1, rest]);
}

// 7. A small overlay fixture with a known opaque/transparent pixel map,
//    decoupled from the real production placeholder so compositing tests
//    don't break if that artwork changes. 400x500 matches the 4:5 output
//    ratio. Opaque cyan 40px border; fully transparent interior.
{
  const w = 400,
    h = 500,
    border = 40;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0, 200, 200, 1)';
  ctx.fillRect(0, 0, w, border);
  ctx.fillRect(0, h - border, w, border);
  ctx.fillRect(0, 0, border, h);
  ctx.fillRect(w - border, 0, border, h);
  const buf = c.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT, 'test-overlay-400x500.png'), buf);
  console.log('test-overlay-400x500.png', buf.length, 'bytes');
}
