/** The longest side of a generated preview image, in pixels. */
export const THUMBNAIL_MAXIMUM_SIDE = 640;

/** The quality of the encoded preview image, between 0 and 1. */
const THUMBNAIL_QUALITY = 0.8;

/** The frame of a video is taken this many seconds after its start. */
const VIDEO_FRAME_SECONDS = 1;

/** A video that reports nothing for this long counts as not decodable. */
const MEDIA_EVENT_TIMEOUT_MILLISECONDS = 10_000;

/** A picture source the canvas can draw, with its natural size. */
interface DrawableSource {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/** Resolves with the next event of the given name; an error event or silence rejects. */
function waitForEvent(target: EventTarget, eventName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function finish(failure: Error | null): void {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, handleEvent);
      target.removeEventListener("error", handleError);
      if (failure) reject(failure);
      else resolve();
    }
    function handleEvent(): void {
      finish(null);
    }
    function handleError(): void {
      finish(new Error(`The media failed before "${eventName}".`));
    }
    const timer = window.setTimeout(() => {
      finish(new Error(`The media did not reach "${eventName}" in time.`));
    }, MEDIA_EVENT_TIMEOUT_MILLISECONDS);
    target.addEventListener(eventName, handleEvent);
    target.addEventListener("error", handleError);
  });
}

/** Draws a source into a new canvas whose longest side fits the thumbnail limit. */
function drawScaled(source: DrawableSource): HTMLCanvasElement | null {
  const longestSide = Math.max(source.width, source.height);
  if (longestSide <= 0) return null;
  const ratio = Math.min(1, THUMBNAIL_MAXIMUM_SIDE / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Decodes an image with an image element, for types `createImageBitmap` refuses. */
async function drawImageElement(
  source: Blob,
): Promise<HTMLCanvasElement | null> {
  const address = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = address;
    await image.decode();
    return drawScaled({
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  } finally {
    URL.revokeObjectURL(address);
  }
}

async function drawImage(source: Blob): Promise<HTMLCanvasElement | null> {
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) return drawImageElement(source);
  try {
    return drawScaled({
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
    });
  } finally {
    bitmap.close();
  }
}

/** Draws the frame of a video near its start; half-way for a very short video. */
async function drawVideo(source: Blob): Promise<HTMLCanvasElement | null> {
  const address = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = waitForEvent(video, "loadeddata");
    video.src = address;
    await loaded;
    const halfDuration = Number.isFinite(video.duration)
      ? video.duration / 2
      : VIDEO_FRAME_SECONDS;
    const sought = waitForEvent(video, "seeked");
    video.currentTime = Math.min(VIDEO_FRAME_SECONDS, halfDuration);
    await sought;
    return drawScaled({
      image: video,
      width: video.videoWidth,
      height: video.videoHeight,
    });
  } finally {
    // Releases the decoder before the address of the bytes goes away.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(address);
  }
}

/** Draws the first page of a PDF. */
async function drawPdf(source: Blob): Promise<HTMLCanvasElement | null> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const { openPdfBytes } = await import("@/app/lib/pdf-preview");
  const preview = await openPdfBytes(bytes);
  try {
    const page = document.createElement("canvas");
    // The preview multiplies by the pixel ratio; the page is wanted in real pixels.
    const width = THUMBNAIL_MAXIMUM_SIDE / (window.devicePixelRatio || 1);
    await preview.render(1, page, width);
    return drawScaled({ image: page, width: page.width, height: page.height });
  } finally {
    preview.close();
  }
}

function drawSource(
  source: Blob,
  mimeType: string,
): Promise<HTMLCanvasElement | null> {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) return drawImage(source);
  if (type.startsWith("video/")) return drawVideo(source);
  if (type === "application/pdf") return drawPdf(source);
  return Promise.resolve(null);
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  type: string,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, THUMBNAIL_QUALITY);
  });
}

/** Encodes as WebP, or as JPEG in a browser that cannot write WebP. */
async function encodeThumbnail(
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  const webp = await encodeCanvas(canvas, "image/webp");
  // A browser without a WebP encoder answers with a PNG instead of nothing.
  if (webp?.type === "image/webp") return webp;
  return encodeCanvas(canvas, "image/jpeg");
}

/**
 * Creates a preview of an image, of the frame of a video near its start, or
 * of the first page of a PDF. Runs in the browser only and never throws.
 *
 * @remarks
 * A video is read through a `blob:` address (`media-src` allows it), a PDF
 * through its bytes, because the page may not fetch a `blob:` address. Every
 * address is revoked again.
 *
 * @param source - The file or blob with the original bytes.
 * @param mimeType - The media type that decides how the bytes are read.
 * @returns The preview, or `null` when the browser cannot produce one, such
 * as for another type or for bytes it cannot decode.
 */
export async function createThumbnail(
  source: Blob,
  mimeType: string,
): Promise<Blob | null> {
  try {
    const canvas = await drawSource(source, mimeType);
    return canvas ? await encodeThumbnail(canvas) : null;
  } catch (error: unknown) {
    console.warn("No preview could be created.", error);
    return null;
  }
}
