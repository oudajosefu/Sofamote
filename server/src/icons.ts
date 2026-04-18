const SIZE = 16;

type RGBA = [number, number, number, number];

const TRANSPARENT: RGBA = [0, 0, 0, 0];
const FOREGROUND: RGBA = [230, 230, 230, 255];
const GREEN: RGBA = [34, 197, 94, 255];
const GREEN_DARK: RGBA = [18, 140, 65, 255];

function mix(over: RGBA, under: RGBA): RGBA {
  const a = over[3] / 255;
  if (a >= 1) return over;
  if (a <= 0) return under;
  const inv = 1 - a;
  return [
    Math.round(over[0] * a + under[0] * inv),
    Math.round(over[1] * a + under[1] * inv),
    Math.round(over[2] * a + under[2] * inv),
    Math.max(over[3], under[3])
  ];
}

function circle(cx: number, cy: number, r: number, color: RGBA) {
  return (x: number, y: number): RGBA => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= r - 0.5) return color;
    if (d >= r + 0.5) return TRANSPARENT;
    const alpha = Math.round(color[3] * (1 - (d - (r - 0.5))));
    return [color[0], color[1], color[2], alpha];
  };
}

function layer(...fns: Array<(x: number, y: number) => RGBA>) {
  return (x: number, y: number): RGBA => {
    let out: RGBA = TRANSPARENT;
    for (const fn of fns) {
      out = mix(fn(x, y), out);
    }
    return out;
  };
}

function buildPixels(draw: (x: number, y: number) => RGBA): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = draw(x, y);
      const i = (y * SIZE + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }
  return pixels;
}

function icoFromRGBA(rgba: Uint8Array): Buffer {
  const pixelRowBytes = SIZE * 4;
  const andRowBytes = Math.ceil(SIZE / 32) * 4;
  const xorSize = pixelRowBytes * SIZE;
  const andSize = andRowBytes * SIZE;
  const bmpSize = 40 + xorSize + andSize;

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(SIZE, 0);
  entry.writeUInt8(SIZE, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(bmpSize, 8);
  entry.writeUInt32LE(6 + 16, 12);

  const bmp = Buffer.alloc(bmpSize);
  bmp.writeUInt32LE(40, 0);
  bmp.writeInt32LE(SIZE, 4);
  bmp.writeInt32LE(SIZE * 2, 8);
  bmp.writeUInt16LE(1, 12);
  bmp.writeUInt16LE(32, 14);
  bmp.writeUInt32LE(0, 16);
  bmp.writeUInt32LE(xorSize, 20);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const src = ((SIZE - 1 - y) * SIZE + x) * 4;
      const dst = 40 + (y * SIZE + x) * 4;
      bmp[dst] = rgba[src + 2] ?? 0;
      bmp[dst + 1] = rgba[src + 1] ?? 0;
      bmp[dst + 2] = rgba[src] ?? 0;
      bmp[dst + 3] = rgba[src + 3] ?? 0;
    }
  }
  return Buffer.concat([dir, entry, bmp]);
}

function playTriangle(x: number, y: number): RGBA {
  const apexX = 12;
  const baseX = 5;
  const topY = 3.5;
  const bottomY = 12.5;
  if (x < baseX - 0.5 || x > apexX + 0.5) return TRANSPARENT;
  const progress = (x - baseX) / (apexX - baseX);
  const halfHeight = (bottomY - topY) / 2 * (1 - Math.max(0, Math.min(1, progress)));
  const cy = (topY + bottomY) / 2;
  if (y + 0.5 < cy - halfHeight) return TRANSPARENT;
  if (y + 0.5 > cy + halfHeight) return TRANSPARENT;
  return FOREGROUND;
}

const neutralDraw = layer(playTriangle);
const activeDraw = layer(
  playTriangle,
  circle(12.5, 12.5, 3.2, GREEN_DARK),
  circle(12.5, 12.5, 2.5, GREEN)
);

export const INACTIVE_ICON_BASE64 = icoFromRGBA(buildPixels(neutralDraw)).toString("base64");
export const ACTIVE_ICON_BASE64 = icoFromRGBA(buildPixels(activeDraw)).toString("base64");
