import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { CardAction } from "../content-card";

import { DocumentBlocks } from "./document-blocks";
import { DocumentSearch } from "./document-search";
import { MarkedText } from "./document-text";
import { blockText } from "./document-model";
import { useBlockSearch } from "./use-block-search";
import { useDocumentImages } from "./use-document";

import type { Slide, SlidesDocument } from "./document-model";

/** The keys that turn the slide. */
const SLIDE_KEY_STEPS: ReadonlyMap<string, number> = new Map([
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
  ["PageUp", -1],
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["PageDown", 1],
]);

/** The text of a slide for the search: its title and its content. */
function slideText(slide: Slide): string {
  return [slide.title, ...slide.blocks.map(blockText)].join("\n");
}

interface SlideViewProps {
  readonly slide: Slide;
  readonly images: ReadonlyMap<string, string>;
  readonly query?: string;
  readonly className?: string;
}

/** One slide as its own card: number, title, text and pictures, in the Pages design. */
export function SlideView({
  slide,
  images,
  query = "",
  className,
}: SlideViewProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <article
      aria-label={t("chatPage.cards.slides.slide", { number: slide.number })}
      className={cn(
        "flex aspect-video w-full flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-6 shadow-xs",
        className,
      )}
      data-slide={slide.number}
    >
      <p className="text-xs font-medium text-primary">
        {t("chatPage.cards.slides.slide", { number: slide.number })}
      </p>
      {slide.title === "" ? null : (
        <h3 className="text-lg leading-snug font-semibold">
          <MarkedText query={query} text={slide.title} />
        </h3>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DocumentBlocks blocks={slide.blocks} images={images} query={query} />
      </div>
    </article>
  );
}

interface SlideStepperProps {
  readonly index: number;
  readonly count: number;
  readonly onStep: (direction: number) => void;
}

/** "Zurück · Folie X von N · Weiter". */
function SlideStepper({
  index,
  count,
  onStep,
}: SlideStepperProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <CardAction
        icon={ChevronLeft}
        isIconOnly
        label={t("chatPage.cards.slides.previous")}
        onClick={() => onStep(-1)}
        variant="quiet"
      />
      <span aria-live="polite" className="min-w-24 text-center tabular-nums">
        {t("chatPage.cards.slides.slideOf", {
          number: count === 0 ? 0 : index + 1,
          count,
        })}
      </span>
      <CardAction
        icon={ChevronRight}
        isIconOnly
        label={t("chatPage.cards.slides.next")}
        onClick={() => onStep(1)}
        variant="quiet"
      />
    </div>
  );
}

/** The slide shown and how to turn it, within the slides. */
function useSlideIndex(count: number): {
  readonly index: number;
  readonly setIndex: (index: number) => void;
  readonly step: (direction: number) => void;
} {
  const [index, setIndex] = useState(0);
  return {
    index: Math.min(index, Math.max(0, count - 1)),
    setIndex,
    step(direction) {
      setIndex((current) =>
        Math.min(Math.max(0, current + direction), Math.max(0, count - 1)),
      );
    },
  };
}

interface SlidesPreviewProps {
  readonly document: SlidesDocument;
  /** Opens every slide next to the chat. */
  readonly onOpen: () => void;
}

/** The slides in a card: one slide at a time, turned with the arrows. */
export function SlidesPreview({
  document,
  onOpen,
}: SlidesPreviewProps): React.ReactElement {
  const { t } = useTranslation();
  const images = useDocumentImages(document.images);
  const { index, step } = useSlideIndex(document.slides.length);
  const slide = document.slides[index];

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const direction = SLIDE_KEY_STEPS.get(event.key);
    if (direction === undefined) return;
    event.preventDefault();
    step(direction);
  }

  return (
    <div className="flex flex-col">
      <div
        className="bg-panel-body p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {slide ? (
          <SlideView images={images} slide={slide} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("chatPage.cards.slides.empty")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5">
        <SlideStepper
          count={document.slides.length}
          index={index}
          onStep={step}
        />
        <button
          className="text-xs font-medium text-primary hover:underline"
          onClick={onOpen}
          type="button"
        >
          {t("chatPage.cards.slides.openAll")}
        </button>
      </div>
    </div>
  );
}

interface SlideStripProps {
  readonly slides: readonly Slide[];
  readonly active: number;
  readonly matches: readonly number[];
  readonly onOpen: (index: number) => void;
}

/** The strip of slides: number and title of each, matches of the search marked. */
function SlideStrip({
  slides,
  active,
  matches,
  onOpen,
}: SlideStripProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("chatPage.cards.slides.strip")}
      className="hidden w-52 shrink-0 overflow-y-auto border-r border-border bg-panel-body p-2 @min-[640px]:block"
    >
      <ol className="flex flex-col gap-1.5">
        {slides.map((slide, index) => (
          <li key={slide.number}>
            <button
              aria-current={index === active ? "true" : undefined}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border bg-surface p-2 text-left text-xs",
                index === active
                  ? "border-primary"
                  : "border-border hover:bg-surface-hover",
                matches.includes(index) && "ring-2 ring-primary-subtle",
              )}
              onClick={() => onOpen(index)}
              type="button"
            >
              <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
                {slide.number}
              </span>
              <span className="line-clamp-2 min-w-0 font-medium">
                {slide.title || t("chatPage.cards.slides.untitled")}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Turns the slides with the arrow and page keys while the full screen is open. */
function useWindowSlideKeys(
  isActive: boolean,
  step: (direction: number) => void,
): void {
  useEffect(() => {
    if (!isActive) return undefined;
    function handleKey(event: KeyboardEvent): void {
      const direction = SLIDE_KEY_STEPS.get(event.key);
      if (direction === undefined || event.target instanceof HTMLInputElement)
        return;
      event.preventDefault();
      step(direction);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActive, step]);
}

/**
 * Every slide next to the chat and in the full screen: the strip
 * of slides, a search over titles and text, and the current slide, turned
 * with the arrows or, in the full screen, with the arrow keys.
 */
export function SlidesPanel({
  document,
  isFullscreen = false,
}: {
  readonly document: SlidesDocument;
  readonly isFullscreen?: boolean;
}): React.ReactElement {
  const images = useDocumentImages(document.images);
  const { index, setIndex, step } = useSlideIndex(document.slides.length);
  const search = useBlockSearch(document.slides.map(slideText));
  const slide = document.slides[index];
  useWindowSlideKeys(isFullscreen, step);

  function handleSearchStep(direction: number): void {
    if (search.matches.length === 0) return;
    const next =
      (search.current + direction + search.matches.length) %
      search.matches.length;
    search.step(direction);
    setIndex(search.matches[next] ?? index);
  }

  function handleQuery(query: string): void {
    search.setQuery(query);
    const needle = query.trim().toLocaleLowerCase();
    const first =
      needle === ""
        ? -1
        : document.slides.findIndex((candidate) =>
            slideText(candidate).toLocaleLowerCase().includes(needle),
          );
    if (first >= 0) setIndex(first);
  }

  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col"
      data-slides-panel=""
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <DocumentSearch
          className="w-72 max-w-full"
          current={search.current}
          matchCount={search.query.trim() === "" ? null : search.matches.length}
          onQuery={handleQuery}
          onStep={handleSearchStep}
          query={search.query}
        />
        <div className="ml-auto">
          <SlideStepper
            count={document.slides.length}
            index={index}
            onStep={step}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <SlideStrip
          active={index}
          matches={search.matches}
          onOpen={setIndex}
          slides={document.slides}
        />
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-panel-body p-4 @min-[640px]:p-8">
          {slide ? (
            <SlideView
              className="max-w-4xl"
              images={images}
              query={search.query}
              slide={slide}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
