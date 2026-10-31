import { createContext, useContext, useRef } from "react";
import { useTranslation } from "react-i18next";

interface ImageProps {
  readonly src: string;
  readonly alt?: string;
}

type OpenImage = (image: HTMLImageElement) => void;

interface OpenableImageProps extends ImageProps {
  readonly onOpen: OpenImage;
}

const IMAGE_CLASS = "max-h-[32rem] max-w-full rounded-lg";

/**
 * Opens an image in the viewer; without one the images only show.
 *
 * @remarks
 * Travels by context, not through the component map of the renderer: a map
 * that changes with the callback would make React rebuild every image, which
 * drops the focus from the control that opened the viewer.
 */
export const ImageOpenContext = createContext<OpenImage | null>(null);

/**
 * The target of the link that wraps the images being rendered.
 *
 * @remarks
 * An image inside a link cannot sit in a button as well, so it opens the
 * viewer on a click and the viewer offers the link target instead.
 */
export const ImageLinkContext = createContext<string | null>(null);

function PlainImage({ src, alt }: ImageProps): React.ReactElement {
  return (
    <img alt={alt} className={`mt-3 ${IMAGE_CLASS}`} loading="lazy" src={src} />
  );
}

/** An image of a link: a click opens the viewer and does not follow the link. */
function LinkedImage({
  src,
  alt,
  linkHref,
  onOpen,
}: OpenableImageProps & { readonly linkHref: string }): React.ReactElement {
  function handleClick(event: React.MouseEvent<HTMLImageElement>): void {
    event.preventDefault();
    onOpen(event.currentTarget);
  }

  return (
    <img
      alt={alt}
      className={`mt-3 cursor-zoom-in ${IMAGE_CLASS}`}
      data-viewer-image=""
      data-viewer-link={linkHref}
      loading="lazy"
      src={src}
      onClick={handleClick}
    />
  );
}

/** An image in its own button, which opens the viewer by mouse and keyboard. */
function ButtonImage({
  src,
  alt,
  onOpen,
}: OpenableImageProps): React.ReactElement {
  const { t } = useTranslation();
  const image = useRef<HTMLImageElement>(null);
  const label = alt
    ? t("markdown.openImage", { name: alt })
    : t("markdown.openImageUnnamed");

  function handleClick(): void {
    if (image.current) {
      onOpen(image.current);
    }
  }

  return (
    <button
      aria-haspopup="dialog"
      aria-label={label}
      className="mt-3 block w-fit max-w-full cursor-zoom-in rounded-lg p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      type="button"
      onClick={handleClick}
    >
      <img
        ref={image}
        alt={alt}
        className={`block ${IMAGE_CLASS}`}
        data-viewer-image=""
        loading="lazy"
        src={src}
      />
    </button>
  );
}

/**
 * An image of rendered markdown.
 *
 * @remarks
 * Where an opener is provided the image is a control that opens the viewer;
 * a click on it is not a click into the text around it.
 */
export function MarkdownImage({ src, alt }: ImageProps): React.ReactElement {
  const onOpen = useContext(ImageOpenContext);
  const linkHref = useContext(ImageLinkContext);

  if (onOpen === null) {
    return <PlainImage alt={alt} src={src} />;
  }

  return linkHref === null ? (
    <ButtonImage alt={alt} src={src} onOpen={onOpen} />
  ) : (
    <LinkedImage alt={alt} linkHref={linkHref} src={src} onOpen={onOpen} />
  );
}
