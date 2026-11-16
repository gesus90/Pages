import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PdfPreview } from "@/app/lib/pdf-preview";
import type { RefObject } from "react";

/** The widest a sheet is drawn, in CSS pixels. */
const PAGE_MAXIMUM_WIDTH = 640;

/** The height of a sheet that is not drawn yet, as a multiple of its width (A4). */
const PAGE_RATIO = 1.4142;

/** Sheets this close to the visible part are drawn; farther ones free their canvas. */
const PAGE_NEAR_MARGIN = "800px 0px";

/** A line across the middle of the area: the sheet on it is the current one. */
const PAGE_CENTER_BAND = "-50% 0px -50% 0px";

interface PdfPageProps {
  readonly preview: PdfPreview;
  readonly pageNumber: number;
  /** The width of every sheet in CSS pixels. */
  readonly width: number;
  readonly area: RefObject<HTMLDivElement | null>;
  readonly onCurrent: (pageNumber: number) => void;
}

/** The measured height of a drawn sheet and the width it was drawn at. */
interface PageSize {
  readonly width: number;
  readonly height: number;
}

/** The width the sheets take: the area, at most {@link PAGE_MAXIMUM_WIDTH}. */
function useSheetWidth(area: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = area.current;

    if (element === null) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);

      if (entry) {
        setWidth(
          Math.min(PAGE_MAXIMUM_WIDTH, Math.floor(entry.contentRect.width)),
        );
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [area]);

  return width;
}

/** Tells whether the sheet is near the visible part of the area. */
function useIsNear(
  item: RefObject<HTMLLIElement | null>,
  area: RefObject<HTMLDivElement | null>,
): boolean {
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = item.current;

    if (element === null) return undefined;

    const observer = new IntersectionObserver(
      (entries) => setIsNear(entries.at(-1)?.isIntersecting === true),
      { root: area.current, rootMargin: PAGE_NEAR_MARGIN },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [item, area]);

  return isNear;
}

/** Reports the sheet as the current one while it lies on the middle line. */
function useReportCurrent(
  props: PdfPageProps,
  item: RefObject<HTMLLIElement | null>,
): void {
  const { area, pageNumber, onCurrent } = props;

  useEffect(() => {
    const element = item.current;

    if (element === null) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.at(-1)?.isIntersecting === true) onCurrent(pageNumber);
      },
      { root: area.current, rootMargin: PAGE_CENTER_BAND },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [item, area, pageNumber, onCurrent]);
}

/**
 * One sheet. It is drawn only near the visible part and its canvas is
 * dropped when it leaves, so a long PDF never holds every page in memory.
 */
function PdfPage(props: PdfPageProps): React.ReactElement {
  const { preview, pageNumber, width, area } = props;
  const { t } = useTranslation();
  const item = useRef<HTMLLIElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const isNear = useIsNear(item, area);
  const [size, setSize] = useState<PageSize | null>(null);
  const height =
    size?.width === width ? size.height : Math.round(width * PAGE_RATIO);

  useReportCurrent(props, item);

  useEffect(() => {
    const element = canvas.current;

    if (!isNear || element === null) return undefined;

    let isCurrent = true;

    preview.render(pageNumber, element, width).then(
      () => {
        if (isCurrent) {
          setSize({ height: element.getBoundingClientRect().height, width });
        }
      },
      (error: unknown) => {
        // A newer drawing on the same canvas or a closed document cancels this one.
        if (isCurrent) console.warn("The PDF page could not be drawn.", error);
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [isNear, preview, pageNumber, width]);

  return (
    <li
      aria-label={t("storage.preview.pageLabel", { n: pageNumber })}
      className="shrink-0 bg-card shadow-xs"
      ref={item}
      style={{ height, width }}
    >
      {isNear ? <canvas className="block h-auto w-full" ref={canvas} /> : null}
    </li>
  );
}

/**
 * A PDF as a column of sheets on the muted surface, with "Seite n von total"
 * at the bottom centre that follows the sheet in the middle of the area.
 * @remarks
 * Every sheet is as wide as the area allows, at most 640 px, with 16 px
 * between them. The page count never takes pointer input and the area keeps
 * room below the last sheet, so it hides nothing for good. The document is
 * drawn into canvases by pdf.js; no script of the PDF runs.
 */
export function StoragePdfView({
  preview,
  label,
}: {
  readonly preview: PdfPreview;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const area = useRef<HTMLDivElement | null>(null);
  const width = useSheetWidth(area);
  const [currentPage, setCurrentPage] = useState(1);
  const pageNumbers = Array.from(
    { length: preview.pageCount },
    (_, index) => index + 1,
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        aria-label={label}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted p-4 pb-16 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        ref={area}
        role="region"
        tabIndex={0}
      >
        {width === 0 ? null : (
          <ol className="flex flex-col items-center gap-4">
            {pageNumbers.map((pageNumber) => (
              <PdfPage
                area={area}
                key={pageNumber}
                onCurrent={setCurrentPage}
                pageNumber={pageNumber}
                preview={preview}
                width={width}
              />
            ))}
          </ol>
        )}
      </div>
      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-foreground shadow-sm">
        {t("storage.preview.page", {
          n: currentPage,
          total: preview.pageCount,
        })}
      </p>
    </div>
  );
}
