import { Boxes, ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { DocumentRuns } from "./document-text";

import type { DocumentBlock } from "./document-model";

type ListItemBlock = Extract<DocumentBlock, { readonly kind: "listItem" }>;

/** Blocks with their index in the document; neighbouring list items form one list. */
type BlockGroup =
  | {
      readonly kind: "block";
      readonly index: number;
      readonly block: DocumentBlock;
    }
  | {
      readonly kind: "list";
      readonly index: number;
      readonly items: readonly {
        readonly index: number;
        readonly block: ListItemBlock;
      }[];
    };

/** The element of each heading level: the card head is the `h2`, so a document starts at `h3`. */
const HEADING_TAGS = ["h3", "h4", "h5", "h6", "h6", "h6"] as const;

const HEADING_CLASSES: readonly string[] = [
  "text-xl font-semibold",
  "text-lg font-semibold",
  "text-base font-semibold",
  "text-sm font-semibold",
  "text-sm font-semibold text-muted-foreground",
  "text-xs font-semibold uppercase text-muted-foreground",
];

/**
 * Groups neighbouring list items, so they render as one list.
 *
 * @param blocks - The blocks in order.
 * @param offset - The index of the first block in the whole document.
 */
export function groupBlocks(
  blocks: readonly DocumentBlock[],
  offset = 0,
): BlockGroup[] {
  const groups: BlockGroup[] = [];
  blocks.forEach((block, position) => {
    const index = offset + position;
    const last = groups.at(-1);
    if (block.kind !== "listItem") groups.push({ kind: "block", index, block });
    else if (last?.kind === "list")
      groups[groups.length - 1] = {
        ...last,
        items: [...last.items, { index, block }],
      };
    else groups.push({ kind: "list", index, items: [{ index, block }] });
  });
  return groups;
}

interface BlockViewProps {
  readonly block: DocumentBlock;
  readonly index: number;
  readonly images: ReadonlyMap<string, string>;
  readonly query: string;
  /** The number of the page that starts after a page break. */
  readonly nextPage: number;
}

function TableBlock({
  block,
  query,
}: {
  readonly block: Extract<DocumentBlock, { readonly kind: "table" }>;
  readonly query: string;
}): React.ReactElement {
  const [head, ...rows] = block.rows;
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        {head ? (
          <thead className="bg-panel-body">
            <tr>
              {head.map((cell, column) => (
                <th
                  key={column}
                  className="border-b border-border px-3 py-1.5 text-left font-semibold whitespace-pre-wrap"
                >
                  <DocumentRuns query={query} runs={cell} />
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-border last:border-b-0"
            >
              {row.map((cell, column) => (
                <td
                  key={column}
                  className="px-3 py-1.5 align-top whitespace-pre-wrap"
                >
                  <DocumentRuns query={query} runs={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageBlock({
  address,
  description,
}: {
  readonly address: string | undefined;
  readonly description: string;
}): React.ReactElement {
  const { t } = useTranslation();
  if (address === undefined)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ImageOff aria-hidden="true" className="size-4" />
        {description || t("chatPage.cards.document.image")}
      </p>
    );
  return (
    <figure className="flex justify-center">
      <img
        alt={description}
        className="max-h-96 max-w-full rounded-md object-contain"
        src={address}
      />
    </figure>
  );
}

/** One block that is no list item. */
function BlockView({
  block,
  index,
  images,
  query,
  nextPage,
}: BlockViewProps): React.ReactElement {
  const { t } = useTranslation();
  const anchor = { "data-block-index": index };
  switch (block.kind) {
    case "heading": {
      const Tag =
        HEADING_TAGS[Math.min(Math.max(block.level, 1), 6) - 1] ?? "h6";
      return (
        <Tag
          {...anchor}
          className={cn(
            "scroll-mt-4 whitespace-pre-wrap",
            HEADING_CLASSES[block.level - 1],
          )}
        >
          <DocumentRuns query={query} runs={block.runs} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p {...anchor} className="whitespace-pre-wrap">
          <DocumentRuns query={query} runs={block.runs} />
        </p>
      );
    case "table":
      return (
        <div {...anchor}>
          <TableBlock block={block} query={query} />
        </div>
      );
    case "image":
      return (
        <div {...anchor}>
          <ImageBlock
            address={images.get(block.imageId)}
            description={block.description}
          />
        </div>
      );
    case "embedded":
      return (
        <p
          {...anchor}
          className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
        >
          <Boxes aria-hidden="true" className="size-4 shrink-0" />
          {t("chatPage.cards.document.embedded")}
        </p>
      );
    case "pageBreak":
      return (
        <div
          {...anchor}
          className="flex items-center gap-3 text-xs text-muted-foreground"
          role="separator"
        >
          <span className="h-px flex-1 bg-border" />
          {t("chatPage.cards.document.pageStart", { page: nextPage })}
          <span className="h-px flex-1 bg-border" />
        </div>
      );
    case "listItem":
      return <></>;
  }
}

function ListView({
  group,
  query,
}: {
  readonly group: Extract<BlockGroup, { readonly kind: "list" }>;
  readonly query: string;
}): React.ReactElement {
  const isOrdered = group.items[0]?.block.isOrdered ?? false;
  const Tag = isOrdered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "flex flex-col gap-1 pl-5",
        isOrdered ? "list-decimal" : "list-disc",
      )}
    >
      {group.items.map(({ index, block }) => (
        <li
          key={index}
          className="whitespace-pre-wrap"
          data-block-index={index}
          style={{ marginInlineStart: `${String(block.level * 1.25)}rem` }}
        >
          <DocumentRuns query={query} runs={block.runs} />
        </li>
      ))}
    </Tag>
  );
}

interface DocumentBlocksProps {
  readonly blocks: readonly DocumentBlock[];
  /** The addresses of the embedded images by their ID. */
  readonly images: ReadonlyMap<string, string>;
  /** Marks the matches of a search. */
  readonly query?: string;
  /** The index of the first block in the whole document, for anchors and page numbers. */
  readonly offset?: number;
  /** The page the first block stands on. */
  readonly firstPage?: number;
  readonly className?: string;
}

/**
 * The blocks of a document as a readable view in the Pages design (PAGE-385):
 * headings, paragraphs, lists, tables, emphasis and images.
 *
 * @remarks
 * Everything is rendered as text by React; nothing of the file becomes
 * markup, and an embedded object is only named. Each block carries
 * `data-block-index` for the table of contents and the search.
 */
export function DocumentBlocks({
  blocks,
  images,
  query = "",
  offset = 0,
  firstPage = 1,
  className,
}: DocumentBlocksProps): React.ReactElement {
  let page = firstPage;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      {groupBlocks(blocks, offset).map((group) => {
        if (group.kind === "list")
          return <ListView key={group.index} group={group} query={query} />;
        if (group.block.kind === "pageBreak") page += 1;
        return (
          <BlockView
            key={group.index}
            block={group.block}
            images={images}
            index={group.index}
            nextPage={page}
            query={query}
          />
        );
      })}
    </div>
  );
}
