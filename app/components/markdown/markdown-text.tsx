import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownLink } from "@/app/components/markdown/markdown-link";
import { cn } from "@/app/lib/cn";
import { transformMarkdownUrl } from "@/app/lib/markdown-links";

import type { Components } from "react-markdown";

interface MarkdownTextProps {
  /** Markdown source; raw HTML in it is shown as text, never executed. */
  readonly source: string;
  readonly className?: string;
}

/** Remark plugins every markdown rendering of Pages uses. */
export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

/** Styled elements shared by ticket descriptions and wiki pages. */
export const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <MarkdownLink href={href}>{children}</MarkdownLink>
  ),
  h1: ({ children }) => (
    <h3 className="mt-4 text-base font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="mt-4 text-sm font-semibold text-foreground first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mt-3 text-sm font-semibold text-foreground first:mt-0">
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6 className="mt-3 text-sm font-medium text-foreground first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="mt-2 first:mt-0">{children}</p>,
  ul: ({ children, className }) => (
    <ul
      className={cn(
        "mt-2 list-disc space-y-1 pl-5 first:mt-0",
        className?.includes("contains-task-list") && "list-none pl-0",
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-1 pl-5 first:mt-0">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 border-border pl-3 italic">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs text-foreground">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code
      className={cn(
        "font-mono text-[0.85em]",
        !className && "rounded bg-muted px-1 py-0.5 text-foreground",
      )}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
  input: ({ checked }) => (
    <input
      checked={checked}
      className="mr-1.5 align-middle"
      disabled
      readOnly
      type="checkbox"
    />
  ),
};

/**
 * Renders a ticket description as safe markdown (GitHub flavour).
 *
 * @remarks
 * No raw HTML is interpreted, images are dropped and only
 * http, https, mailto and relative link targets survive.
 */
export function MarkdownText({
  source,
  className,
}: MarkdownTextProps): React.ReactElement {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <Markdown
        components={MARKDOWN_COMPONENTS}
        disallowedElements={["img"]}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        unwrapDisallowed
        urlTransform={transformMarkdownUrl}
      >
        {source}
      </Markdown>
    </div>
  );
}
