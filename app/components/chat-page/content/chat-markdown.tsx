import { isValidElement } from "react";
import Markdown from "react-markdown";

import {
  MARKDOWN_COMPONENTS,
  MARKDOWN_REMARK_PLUGINS,
} from "@/app/components/markdown/markdown-text";
import { cn } from "@/app/lib/cn";
import { transformMarkdownUrl } from "@/app/lib/markdown-links";

import { CodeView } from "./code-view";

import type { Components } from "react-markdown";

/** Reads the language and the text of the `<code>` element a fenced block renders. */
function readCodeBlock(children: React.ReactNode): {
  readonly languageHint: string;
  readonly source: string;
} | null {
  if (
    !isValidElement<{ className?: string; children?: React.ReactNode }>(
      children,
    )
  )
    return null;
  const { className, children: content } = children.props;
  if (typeof content !== "string") return null;
  return {
    languageHint: /language-(\S+)/u.exec(className ?? "")?.[1] ?? "",
    source: content.replace(/\n$/u, ""),
  };
}

const COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  img: () => null,
  pre: ({ children }) => {
    const block = readCodeBlock(children);
    if (!block) return <pre className="mt-2 overflow-x-auto">{children}</pre>;
    return (
      <CodeView
        className="mt-2 overflow-hidden rounded-lg border border-border first:mt-0"
        languageHint={block.languageHint}
        source={block.source}
      />
    );
  },
};

interface ChatMarkdownProps {
  /** Markdown source; raw HTML in it is shown as text, never executed. */
  readonly source: string;
  readonly className?: string;
}

/**
 * Markdown of a Markdown card, rendered as the chat renders text: headings,
 * lists, tables and code, whose blocks take the syntax colors of the code
 * cards (PAGE-298). Images are not loaded.
 */
export function ChatMarkdown({
  source,
  className,
}: ChatMarkdownProps): React.ReactElement {
  return (
    <div
      className={cn(
        "pages-selectable text-sm leading-relaxed break-words text-foreground",
        className,
      )}
    >
      <Markdown
        components={COMPONENTS}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        urlTransform={transformMarkdownUrl}
      >
        {source}
      </Markdown>
    </div>
  );
}
