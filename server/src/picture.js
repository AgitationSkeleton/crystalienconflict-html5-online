// A shared map's picture, as the game drew it (src/online/custom.js thumbnail: the map in the
// game's own art) and sent it with the map: a JPEG or PNG, checked to be one -- its signature,
// its size, and its width and height from its own header -- before it is kept and shown.  It is
// only ever served as the image it is (its own type, nosniff).

const MAX_BYTES = 400 * 1024;
const MIN_SIDE = 16;
const MAX_SIDE = 1024;

// base64 text -> { bytes, type, w, h }, or null when it is not a picture this server keeps.
export function checkPicture(text) {
  if (typeof text !== 'string' || text.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  let bytes;
  try {
    bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch (e) {
    return null;
  }
  const size = bytes[0] === 0x89 ? png(bytes) : bytes[0] === 0xff ? jpeg(bytes) : null;
  if (!size) return null;
  const [w, h, type] = size;
  if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE) return null;
  return { bytes, type, w, h };
}

function png(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [v.getUint32(16), v.getUint32(20), 'image/png'];
}

// (the first frame header's size: the markers walked from the start)
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6], 'image/jpeg'];
    }
    i += 2 + len;
  }
  return null;
}
