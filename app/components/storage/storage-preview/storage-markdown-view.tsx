import Markdown from "react-markdown";

import {
  MARKDOWN_COMPONENTS,
  MARKDOWN_REMARK_PLUGINS,
} from "@/app/components/markdown/markdown-text";
import { transformMarkdownUrl } from "@/app/lib/markdown-links";

import { StoragePreviewScroller } from "./storage-preview-scroller";

import type { Components } from "react-markdown";

/**
 * The Markdown elements of the preview: the shared styles of Pages, tuned to
 * a reading column of 15/26 px text with 24/32 and 18/28 px headings.
 */
const STORAGE_MARKDOWN_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-primary pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => (
    <h1 className="mt-8 text-2xl leading-8 font-bold text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-7 text-lg leading-7 font-bold text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-base leading-6 font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 text-[15px] leading-6 font-semibold text-foreground first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="mt-3 first:mt-0">{children}</p>,
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
};

/**
 * A Markdown file as a reading column.
 * @remarks
 * The existing safe renderer draws the text: raw HTML in the file is shown as
 * text and never run, images are dropped so nothing loads by itself, and
 * only http, https, mailto and relative link targets survive. Tables and code
 * blocks scroll inside their own area, never the page.
 */
export function StorageMarkdownView({
  source,
  label,
}: {
  readonly source: string;
  readonly label: string;
}): React.ReactElement {
  return (
    <StoragePreviewScroller label={label}>
      <div className="mx-auto w-full max-w-180 px-5 py-6 text-[15px] leading-[26px] break-words text-foreground md:p-8">
        <Markdown
          components={STORAGE_MARKDOWN_COMPONENTS}
          disallowedElements={["img"]}
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          unwrapDisallowed
          urlTransform={transformMarkdownUrl}
        >
          {source}
        </Markdown>
      </div>
    </StoragePreviewScroller>
  );
}
