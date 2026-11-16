import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { DocumentBlocks } from "./document-blocks";
import { DocumentSearch } from "./document-search";
import { blockText, runsText } from "./document-model";
import { useBlockSearch } from "./use-block-search";
import { useDocumentImages } from "./use-document";

import type { DocumentBlock, WordDocument } from "./document-model";

/** Most blocks the card shows of the first page. */
const PREVIEW_BLOCKS = 14;

/**
 * The start of a document as the card shows it: its first page, at most 14
 * blocks.
 * @param blocks - Every block of the document.
 */
export function firstPageBlocks(
  blocks: readonly DocumentBlock[],
): readonly DocumentBlock[] {
  const pageEnd = blocks.findIndex((block) => block.kind === "pageBreak");
  return blocks.slice(
    0,
    Math.min(pageEnd < 0 ? blocks.length : pageEnd, PREVIEW_BLOCKS),
  );
}

interface WordPreviewProps {
  readonly document: WordDocument;
  /** Opens the whole document next to the chat. */
  readonly onOpen: () => void;
}

/**
 * The start of a Word or OpenDocument text in a card, in the
 * Pages design, with "Seite 1 von N · Ganzes Dokument öffnen".
 */
export function WordPreview({
  document,
  onOpen,
}: WordPreviewProps): React.ReactElement {
  const { t } = useTranslation();
  const images = useDocumentImages(document.images);
  const blocks = firstPageBlocks(document.blocks);
  return (
    <div className="flex flex-col">
      <div className="relative max-h-96 overflow-hidden px-5 py-4">
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("chatPage.cards.document.empty")}
          </p>
        ) : (
          <DocumentBlocks blocks={blocks} images={images} />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-surface"
        />
      </div>
      <p className="flex flex-wrap items-center gap-x-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>
          {t("chatPage.cards.document.pageOf", {
            page: 1,
            count: document.pageCount,
          })}
        </span>
        <span aria-hidden="true">·</span>
        <button
          className="font-medium text-primary hover:underline"
          onClick={onOpen}
          type="button"
        >
          {t("chatPage.cards.document.openWhole")}
        </button>
      </p>
    </div>
  );
}

interface HeadingEntry {
  readonly index: number;
  readonly level: number;
  readonly text: string;
}

function headingsOf(blocks: readonly DocumentBlock[]): HeadingEntry[] {
  return blocks.flatMap((block, index) =>
    block.kind === "heading"
      ? [{ index, level: block.level, text: runsText(block.runs).trim() }]
      : [],
  );
}

/** The table of contents of a document from its headings. */
function Contents({
  headings,
  onOpen,
}: {
  readonly headings: readonly HeadingEntry[];
  readonly onOpen: (index: number) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("chatPage.cards.document.contents")}
      className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-panel-body p-3 @min-[720px]:flex"
    >
      <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
        {t("chatPage.cards.document.contents")}
      </p>
      {headings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("chatPage.cards.document.noHeadings")}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {headings.map((heading) => (
            <li key={heading.index}>
              <button
                className={cn(
                  "w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-surface-hover",
                  heading.level <= 1
                    ? "font-semibold"
                    : "text-muted-foreground",
                )}
                onClick={() => onOpen(heading.index)}
                style={{
                  paddingInlineStart: `${String(0.5 + (heading.level - 1) * 0.75)}rem`,
                }}
                type="button"
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/**
 * The whole Word or OpenDocument text next to the chat and in the full
 * screen: a table of contents from the headings, a search with
 * its matches marked, and the document as a readable page in the Pages design.
 */
export function WordPanel({
  document,
}: {
  readonly document: WordDocument;
}): React.ReactElement {
  const { t } = useTranslation();
  const images = useDocumentImages(document.images);
  const search = useBlockSearch(document.blocks.map(blockText));
  return (
    <div className="@container flex min-h-0 flex-1 flex-col" data-word-panel="">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <DocumentSearch
          className="w-72 max-w-full"
          current={search.current}
          matchCount={search.query.trim() === "" ? null : search.matches.length}
          onQuery={search.setQuery}
          onStep={search.step}
          query={search.query}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {t("chatPage.cards.document.pages", { count: document.pageCount })}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <Contents
          headings={headingsOf(document.blocks)}
          onOpen={search.reveal}
        />
        <div
          ref={search.container}
          className="min-h-0 flex-1 overflow-y-auto bg-panel-body p-4 @min-[720px]:p-8"
        >
          <article className="mx-auto max-w-3xl rounded-xl border border-border bg-surface px-6 py-6 shadow-xs @min-[720px]:px-10">
            <DocumentBlocks
              blocks={document.blocks}
              images={images}
              query={search.query}
            />
            {document.isTruncated ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {t("chatPage.cards.document.truncated")}
              </p>
            ) : null}
          </article>
        </div>
      </div>
    </div>
  );
}
