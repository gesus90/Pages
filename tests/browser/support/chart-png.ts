import { deflateSync } from "node:zlib";

/** Colors of one chart; every image of the fixtures gets its own palette. */
export interface ChartPalette {
  readonly background: readonly [number, number, number];
  readonly accent: readonly [number, number, number];
  readonly line: readonly [number, number, number];
}

/** What a test chart looks like. */
export interface ChartOptions {
  readonly width: number;
  readonly height: number;
  readonly palette: ChartPalette;
  /** Number of small marks at the top, so the images differ at a glance. */
  readonly marks: number;
}

type Color = readonly [number, number, number];

const BORDER_COLOR: Color = [20, 20, 20];
const CORNER_COLORS: readonly Color[] = [
  [220, 38, 38],
  [22, 163, 74],
  [37, 99, 235],
  [234, 179, 8],
];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  const typeBytes = Buffer.from(type, "ascii");

  length.writeUInt32BE(body.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])));

  return Buffer.concat([length, typeBytes, body, checksum]);
}

/** The geometry of a chart, derived once from its options. */
interface ChartGeometry {
  readonly edge: number;
  readonly corner: number;
  readonly mark: number;
}

function measureChart({ width, height }: ChartOptions): ChartGeometry {
  const shortSide = Math.min(width, height);

  return {
    corner: Math.round(shortSide / 6),
    edge: Math.max(4, Math.round(shortSide / 100)),
    mark: Math.round(shortSide / 24),
  };
}

function isBorder(
  options: ChartOptions,
  geometry: ChartGeometry,
  x: number,
  y: number,
): boolean {
  const { edge } = geometry;

  return (
    x < edge ||
    y < edge ||
    x >= options.width - edge ||
    y >= options.height - edge
  );
}

/** Color of the corner square the pixel is in, or `null` outside the squares. */
function cornerColor(
  options: ChartOptions,
  geometry: ChartGeometry,
  x: number,
  y: number,
): Color | null {
  const { corner } = geometry;
  const isRight = x >= options.width - corner;
  const isBottom = y >= options.height - corner;

  if ((x < corner || isRight) && (y < corner || isBottom)) {
    return CORNER_COLORS[(isBottom ? 2 : 0) + (isRight ? 1 : 0)] ?? null;
  }

  return null;
}

function isMark(
  options: ChartOptions,
  geometry: ChartGeometry,
  x: number,
  y: number,
): boolean {
  const { edge, mark } = geometry;
  const count = options.marks * 2 - 1;
  const start = Math.round((options.width - count * mark) / 2);
  const index = Math.floor((x - start) / mark);

  return (
    y >= edge * 2 &&
    y < edge * 2 + mark &&
    index >= 0 &&
    index < count &&
    index % 2 === 0
  );
}

function isCircle(options: ChartOptions, x: number, y: number): boolean {
  const radius = Math.min(options.width, options.height) / 4;

  return (
    (x - options.width / 2) ** 2 + (y - options.height / 2) ** 2 < radius ** 2
  );
}

/** Picks the color of one pixel of the chart; integer arithmetic only. */
function chartPixel(
  options: ChartOptions,
  geometry: ChartGeometry,
  x: number,
  y: number,
): Color {
  const { width, height, palette } = options;

  if (isBorder(options, geometry, x, y)) {
    return BORDER_COLOR;
  }

  const corner = cornerColor(options, geometry, x, y);

  if (corner) {
    return corner;
  }

  if (isMark(options, geometry, x, y)) {
    return palette.line;
  }

  if (isCircle(options, x, y)) {
    return palette.accent;
  }

  const diagonal = Math.abs(x * height - y * width) / Math.hypot(width, height);

  return diagonal < geometry.edge ? palette.line : palette.background;
}

/**
 * Draws a test chart as a PNG.
 *
 * @param options - Size, colors and marks of the chart.
 * @returns The bytes of the image.
 *
 * @remarks
 * Flat colors and hard edges only, no text and no smoothing, so the same
 * options give the same bytes on every machine and a crop or a stretch shows
 * on the chart: dark border, one color per corner, a circle in the middle,
 * a diagonal and as many marks at the top as the image has in its row.
 */
export function drawChartPng(options: ChartOptions): Buffer {
  const { width, height } = options;
  const geometry = measureChart(options);
  const rowLength = width * 3 + 1;
  const raw = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength + 1;

    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = chartPixel(options, geometry, x, y);
      const offset = rowStart + x * 3;

      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
    }
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
