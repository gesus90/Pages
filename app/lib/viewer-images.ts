/** Marks a rendered image that the image viewer can open. */
export const VIEWER_IMAGE_ATTRIBUTE = "data-viewer-image";

/** Marks the rendered text whose images the viewer pages through together. */
export const VIEWER_SCOPE_ATTRIBUTE = "data-viewer-scope";

/** Carries the target of the link that wraps a viewable image. */
export const VIEWER_LINK_ATTRIBUTE = "data-viewer-link";

/** One image of the viewer, read from the rendered text. */
export interface ViewerImage {
  /** Address exactly as the text shows it, so the viewer loads the same file. */
  readonly src: string;
  readonly alt: string;
  /** Target of the link around the image, `null` for a plain image. */
  readonly linkHref: string | null;
}

/** The images of one text in their displayed order and the one that opened. */
export interface ViewerImages {
  readonly images: readonly ViewerImage[];
  readonly index: number;
}

function readViewerImage(element: HTMLImageElement): ViewerImage {
  return {
    alt: element.getAttribute("alt") ?? "",
    linkHref: element.getAttribute(VIEWER_LINK_ATTRIBUTE),
    src: element.getAttribute("src") ?? "",
  };
}

/**
 * Collects the images of the text an image belongs to.
 *
 * @param opened - The image a person clicked.
 * @returns The images of that text in displayed order, or `null` when the
 * image is not inside viewable text.
 *
 * @remarks
 * The rendered document is the source of truth: only what the text shows
 * counts, in the order it shows it, and only from this one text. Images of
 * other tickets, attachments that are merely listed, and images the renderer
 * refused are never part of it.
 */
export function collectViewerImages(
  opened: HTMLImageElement,
): ViewerImages | null {
  const scope = opened.closest(`[${VIEWER_SCOPE_ATTRIBUTE}]`);

  if (!scope) {
    return null;
  }

  const elements = [
    ...scope.querySelectorAll<HTMLImageElement>(`[${VIEWER_IMAGE_ATTRIBUTE}]`),
  ];
  const index = elements.indexOf(opened);

  if (index === -1) {
    return null;
  }

  return { images: elements.map(readViewerImage), index };
}

/**
 * Returns the index a step away from the current one.
 *
 * @param index - Current position.
 * @param count - Number of images.
 * @param step - `-1` for the previous image, `1` for the next one.
 * @returns The new position, or `null` at the start or end of the list.
 */
export function stepViewerIndex(
  index: number,
  count: number,
  step: -1 | 1,
): number | null {
  const next = index + step;

  return next >= 0 && next < count ? next : null;
}
