import { deflateSync } from "node:zlib";

/** Images of one PDF page an agent receives at most (PAGE-386). */
const MAXIMUM_IMAGES = 4;

/** Pixels of one image that are encoded at most; larger ones are left out. */
const MAXIMUM_PIXELS = 16_000_000;

/** How long reading the images of one page may take. */
const DEADLINE_MILLISECONDS = 20_000;

/** The pixel layouts of decoded PDF images (pdf.js `ImageKind`). */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/** A decoded image as pdf.js resolves it in Node. */
interface PdfImageData {
  readonly width: number;
  readonly height: number;
  readonly kind: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

function isPdfImageData(value: unknown): value is PdfImageData {
  if (typeof value !== "object" || value === null) return false;
  const width: unknown = Reflect.get(value, "width");
  const height: unknown = Reflect.get(value, "height");
  const pixels: unknown = Reflect.get(value, "data");
  return (
    typeof width === "number" &&
    typeof height === "number" &&
    typeof Reflect.get(value, "kind") === "number" &&
    (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** The RGBA value of one pixel of a decoded image. */
function pixel(image: PdfImageData, index: number): readonly number[] {
  const { data: pixels, kind, width } = image;
  if (kind === RGBA_32BPP) {
    const at = index * 4;
    return [
      pixels[at] ?? 0,
      pixels[at + 1] ?? 0,
      pixels[at + 2] ?? 0,
      pixels[at + 3] ?? 255,
    ];
  }
  if (kind === RGB_24BPP) {
    const at = index * 3;
    return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, 255];
  }
  // One bit per pixel, rows padded to whole bytes, 1 is white.
  const row = Math.floor(index / width);
  const column = index % width;
  const byte = pixels[row * Math.ceil(width / 8) + Math.floor(column / 8)] ?? 0;
  const value = (byte >> (7 - (column % 8))) & 1 ? 255 : 0;
  return [value, value, value, 255];
}

/**
 * Encodes decoded pixels as a PNG, without any image library.
 *
 * @param image - Width, height, pixel layout and pixels.
 * @returns The PNG file, or `null` for an unknown layout or too many pixels.
 */
export function encodePdfImagePng(image: PdfImageData): Buffer | null {
  const { width, height, kind } = image;
  if (![GRAYSCALE_1BPP, RGB_24BPP, RGBA_32BPP].includes(kind)) return null;
  if (width < 1 || height < 1 || width * height > MAXIMUM_PIXELS) return null;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const start = row * (width * 4 + 1);
    for (let column = 0; column < width; column += 1)
      raw.set(pixel(image, row * width + column), start + 1 + column * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Resolves one image object of a page, or `null` when it does not resolve in time. */
function resolveImage(
  objects: {
    get(objId: string, callback?: (resolved: unknown) => void): unknown;
  },
  name: string,
  deadline: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(null),
      Math.max(0, deadline - Date.now()),
    );
    objects.get(name, (resolved: unknown) => {
      clearTimeout(timer);
      resolve(resolved);
    });
  });
}

/**
 * Reads the images drawn on one page of a PDF as PNG files (PAGE-386).
 *
 * @remarks
 * pdf.js decodes the images without running scripts of the file, as in
 * the text reading of PDFs; image masks and repeated patterns are left out,
 * at most {@link MAXIMUM_IMAGES} images and a bounded time.
 *
 * @param bytes - The complete file.
 * @param pageNumber - The page, counted from 1.
 * @returns The images as PNG, none for a page without images or that cannot be read.
 */
export async function readPdfPageImages(
  bytes: Buffer,
  pageNumber: number,
): Promise<Buffer[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const deadline = Date.now() + DEADLINE_MILLISECONDS;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useWasm: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (pageNumber < 1 || pageNumber > document.numPages) return [];
    const page = await document.getPage(pageNumber);
    const operators = await page.getOperatorList();
    const names: string[] = [];
    operators.fnArray.forEach((operation, index) => {
      const rawArgs: unknown = operators.argsArray[index];
      const name: unknown = Array.isArray(rawArgs) ? rawArgs[0] : undefined;
      if (operation === pdfjs.OPS.paintImageXObject && typeof name === "string")
        names.push(name);
    });
    const images: Buffer[] = [];
    for (const name of [...new Set(names)].slice(0, MAXIMUM_IMAGES)) {
      const objects = name.startsWith("g_") ? page.commonObjs : page.objs;
      const resolved = await resolveImage(objects, name, deadline);
      const png = isPdfImageData(resolved) ? encodePdfImagePng(resolved) : null;
      if (png) images.push(png);
    }
    page.cleanup();
    return images;
  } catch {
    return [];
  } finally {
    await task.destroy();
  }
}
