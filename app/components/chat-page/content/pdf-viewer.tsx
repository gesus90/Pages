import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import type { KeyboardEvent, RefObject } from "react";
import type { PdfPreview } from "@/app/lib/pdf-preview";

const ZOOM_MINIMUM_PERCENT = 50;
const ZOOM_MAXIMUM_PERCENT = 300;
const ZOOM_STEP_PERCENT = 25;

/** The width of a page at 100 %, in CSS pixels, before the area is measured. */
const PAGE_DEFAULT_WIDTH = 560;
const PAGE_MINIMUM_WIDTH = 240;
const PAGE_MAXIMUM_WIDTH = 640;
/** The free space kept left and right of a page at 100 %, in CSS pixels. */
const PAGE_AREA_PADDING = 48;

/** The width a page thumbnail is drawn in, in CSS pixels. */
const THUMBNAIL_WIDTH = 126;
/** Thumbnails this close to the visible part of the list are drawn already. */
const THUMBNAIL_NEAR_MARGIN = "400px 0px";
const THUMBNAIL_SCROLL_GAP = 12;

/** The keys that turn the page while the viewer has the focus. */
const PAGE_KEY_STEPS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -1],
  ["PageUp", -1],
  ["ArrowRight", 1],
  ["PageDown", 1],
]);

/** Props of the PDF viewer of a chat content card. */
export interface PdfViewerProps {
  /** Same-origin address of the PDF (authenticated download URL). */
  readonly url: string;
  /** Tells the page count once the document is open. */
  readonly onPageCount?: (pageCount: number) => void;
  readonly className?: string;
}

interface PdfDocumentState {
  readonly preview: PdfPreview | null;
  readonly hasFailed: boolean;
}

interface PageRenderInput {
  readonly preview: PdfPreview;
  readonly pageNumber: number;
  readonly width: number;
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly isWanted: boolean;
}

interface PdfToolbarProps {
  readonly zoomPercent: number;
  readonly pageNumber: number;
  /** Zero while no document is open; the controls are disabled then. */
  readonly pageCount: number;
  readonly onZoomStep: (direction: number) => void;
  readonly onPageStep: (direction: number) => void;
}

interface PdfThumbnailProps {
  readonly preview: PdfPreview;
  readonly pageNumber: number;
  readonly isCurrent: boolean;
  readonly onOpen: (pageNumber: number) => void;
}

interface PdfThumbnailListProps {
  readonly preview: PdfPreview;
  readonly pageNumber: number;
  readonly onOpen: (pageNumber: number) => void;
}

interface PdfPageAreaProps {
  readonly preview: PdfPreview;
  readonly pageNumber: number;
  readonly zoomPercent: number;
}

function clamp(amount: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, amount));
}

/** Opens the PDF of an address; leaving closes it and aborts the download. */
function usePdfDocument(url: string): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>({
    preview: null,
    hasFailed: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    let opened: PdfPreview | null = null;
    async function open(): Promise<void> {
      try {
        const { openPdfPreview } = await import("@/app/lib/pdf-preview");
        const preview = await openPdfPreview(url, controller.signal);
        if (controller.signal.aborted) {
          preview.close();
          return;
        }
        opened = preview;
        setState({ preview, hasFailed: false });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        console.warn("The PDF could not be opened.", error);
        setState({ preview: null, hasFailed: true });
      }
    }
    void open();
    return (): void => {
      controller.abort();
      opened?.close();
    };
  }, [url]);

  return state;
}

/** Draws one page into a canvas whenever the page or its width changes. */
function usePageRender(input: PageRenderInput): void {
  const { preview, pageNumber, width, canvas, isWanted } = input;
  useEffect(() => {
    const element = canvas.current;
    if (!isWanted || !element) return undefined;
    let isCurrent = true;
    preview.render(pageNumber, element, width).catch((error: unknown) => {
      // A newer page on the same canvas or a closed document cancels the drawing.
      if (isCurrent) console.warn("The PDF page could not be drawn.", error);
    });
    return (): void => {
      isCurrent = false;
    };
  }, [preview, pageNumber, width, canvas, isWanted]);
}

/** Scrolls the list just far enough to show the item, without moving the page. */
function revealInList(item: HTMLElement): void {
  const list = item.parentElement;
  if (!list) return;
  const listBox = list.getBoundingClientRect();
  const itemBox = item.getBoundingClientRect();
  if (itemBox.top < listBox.top) {
    list.scrollTop -= listBox.top - itemBox.top + THUMBNAIL_SCROLL_GAP;
  } else if (itemBox.bottom > listBox.bottom) {
    list.scrollTop += itemBox.bottom - listBox.bottom + THUMBNAIL_SCROLL_GAP;
  }
}

function PdfToolbar({
  zoomPercent,
  pageNumber,
  pageCount,
  onZoomStep,
  onPageStep,
}: PdfToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  const isOpen = pageCount > 0;
  return (
    <div
      role="toolbar"
      className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 text-xs text-foreground"
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t("chatPage.cards.pdf.zoomOut")}
        disabled={!isOpen || zoomPercent <= ZOOM_MINIMUM_PERCENT}
        onClick={() => onZoomStep(-1)}
      >
        <Minus className="size-4" aria-hidden="true" />
      </Button>
      <span className="min-w-14 text-center tabular-nums">
        {t("chatPage.cards.pdf.zoom", { percent: zoomPercent })}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t("chatPage.cards.pdf.zoomIn")}
        disabled={!isOpen || zoomPercent >= ZOOM_MAXIMUM_PERCENT}
        onClick={() => onZoomStep(1)}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="ml-3"
        aria-label={t("chatPage.cards.pdf.previousPage")}
        disabled={!isOpen || pageNumber <= 1}
        onClick={() => onPageStep(-1)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <span className="min-w-24 text-center tabular-nums" aria-live="polite">
        {isOpen
          ? t("chatPage.cards.pdf.page", { page: pageNumber, count: pageCount })
          : null}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t("chatPage.cards.pdf.nextPage")}
        disabled={!isOpen || pageNumber >= pageCount}
        onClick={() => onPageStep(1)}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** One page of the sidebar; it is drawn only once it scrolls near the visible part. */
function PdfThumbnail({
  preview,
  pageNumber,
  isCurrent,
  onOpen,
}: PdfThumbnailProps): React.ReactElement {
  const { t } = useTranslation();
  const item = useRef<HTMLLIElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = item.current;
    if (isNear || !element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsNear(true);
      },
      { root: element.parentElement, rootMargin: THUMBNAIL_NEAR_MARGIN },
    );
    observer.observe(element);
    return (): void => observer.disconnect();
  }, [isNear]);

  useEffect(() => {
    if (isCurrent && item.current) revealInList(item.current);
  }, [isCurrent]);

  usePageRender({
    preview,
    pageNumber,
    width: THUMBNAIL_WIDTH,
    canvas,
    isWanted: isNear,
  });

  return (
    <li ref={item}>
      <button
        type="button"
        aria-label={t("chatPage.cards.pdf.openPage", { page: pageNumber })}
        aria-current={isCurrent ? "page" : undefined}
        onClick={() => onOpen(pageNumber)}
        className={cn(
          "block w-full overflow-hidden rounded-md border-2 bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          isCurrent ? "border-primary" : "border-border",
        )}
      >
        {isNear ? (
          <canvas ref={canvas} className="block h-auto w-full" />
        ) : (
          <span className="block aspect-[210/297]" />
        )}
      </button>
    </li>
  );
}

function PdfThumbnailList({
  preview,
  pageNumber,
  onOpen,
}: PdfThumbnailListProps): React.ReactElement {
  const { t } = useTranslation();
  const pageNumbers = Array.from(
    { length: preview.pageCount },
    (_, index) => index + 1,
  );
  return (
    <nav
      aria-label={t("chatPage.cards.pdf.pages")}
      className="hidden w-[150px] shrink-0 border-r border-border bg-panel-body @min-[520px]:flex"
    >
      <ScrollViewport
        as="ul"
        containerClassName="flex-1"
        className="flex flex-col gap-2 p-2.5"
      >
        {pageNumbers.map((number) => (
          <PdfThumbnail
            key={number}
            preview={preview}
            pageNumber={number}
            isCurrent={number === pageNumber}
            onOpen={onOpen}
          />
        ))}
      </ScrollViewport>
    </nav>
  );
}

/** The current page, centred, in an area that scrolls both ways. */
function PdfPageArea({
  preview,
  pageNumber,
  zoomPercent,
}: PdfPageAreaProps): React.ReactElement {
  const viewport = useRef<HTMLElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [baseWidth, setBaseWidth] = useState(PAGE_DEFAULT_WIDTH);
  const width = Math.round((baseWidth * zoomPercent) / 100);

  usePageRender({ preview, pageNumber, width, canvas, isWanted: true });

  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [pageNumber]);

  function handleMeasure(element: HTMLElement): void {
    // The outer width, so that an appearing scrollbar does not change the page.
    const available = Math.round(element.offsetWidth - PAGE_AREA_PADDING);
    setBaseWidth(clamp(available, PAGE_MINIMUM_WIDTH, PAGE_MAXIMUM_WIDTH));
  }

  return (
    <ScrollViewport
      ref={viewport}
      axis="both"
      containerClassName="flex-1 bg-muted"
      className="flex p-4"
      onViewportMeasure={handleMeasure}
    >
      <canvas
        ref={canvas}
        style={{ width }}
        className="m-auto block h-auto max-w-none shrink-0 shadow-xs"
      />
    </ScrollViewport>
  );
}

function PdfViewerDocument({
  url,
  onPageCount,
  className,
}: PdfViewerProps): React.ReactElement {
  const { t } = useTranslation();
  const { preview, hasFailed } = usePdfDocument(url);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100);
  const pageCount = preview?.pageCount ?? 0;

  useEffect(() => {
    if (preview) onPageCount?.(preview.pageCount);
  }, [preview, onPageCount]);

  function handlePageStep(direction: number): void {
    if (pageCount === 0) return;
    setPageNumber((current) => clamp(current + direction, 1, pageCount));
  }

  function handleZoomStep(direction: number): void {
    setZoomPercent((current) =>
      clamp(
        current + direction * ZOOM_STEP_PERCENT,
        ZOOM_MINIMUM_PERCENT,
        ZOOM_MAXIMUM_PERCENT,
      ),
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const direction = PAGE_KEY_STEPS.get(event.key);
    if (direction === undefined || pageCount === 0) return;
    event.preventDefault();
    handlePageStep(direction);
  }

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "@container flex size-full min-h-0 min-w-0 flex-col bg-surface text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      <PdfToolbar
        zoomPercent={zoomPercent}
        pageNumber={pageNumber}
        pageCount={pageCount}
        onZoomStep={handleZoomStep}
        onPageStep={handlePageStep}
      />
      {preview ? (
        <div className="flex min-h-0 flex-1">
          <PdfThumbnailList
            preview={preview}
            pageNumber={pageNumber}
            onOpen={setPageNumber}
          />
          <PdfPageArea
            preview={preview}
            pageNumber={pageNumber}
            zoomPercent={zoomPercent}
          />
        </div>
      ) : (
        <p
          role={hasFailed ? "alert" : "status"}
          className="flex min-h-0 flex-1 items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground"
        >
          {t(
            hasFailed
              ? "chatPage.cards.pdf.failed"
              : "chatPage.cards.pdf.loading",
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Shows a PDF with a toolbar for zoom and pages, page thumbnails and the
 * current page. It fills its container and brings no title or close button;
 * the surrounding dialog or panel provides name, download and close.
 *
 * @remarks
 * The arrow and page keys turn the page while the viewer has the focus. The
 * document is closed and its download aborted when the viewer goes away or
 * gets another address.
 *
 * @param props - The address of the PDF and the optional page count callback.
 */
export function PdfViewer(props: PdfViewerProps): React.ReactElement {
  // Another address starts over: first page, 100 %, loading.
  return <PdfViewerDocument key={props.url} {...props} />;
}
