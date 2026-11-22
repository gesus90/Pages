import { useMemo, useState } from "react";
import Markdown from "react-markdown";

import {
  CALLOUT_STYLES,
  isCalloutKind,
} from "@/app/components/markdown/callout-style";
import {
  ImageLinkContext,
  ImageOpenContext,
  MarkdownImage,
} from "@/app/components/markdown/markdown-image";
import { MarkdownLink } from "@/app/components/markdown/markdown-link";
import {
  TicketCard,
  TicketPill,
  TicketPreviewLayer,
} from "@/app/components/markdown/ticket-pill";
import {
  MARKDOWN_COMPONENTS,
  MARKDOWN_REMARK_PLUGINS,
} from "@/app/components/markdown/markdown-text";
import { cn } from "@/app/lib/cn";
import { toOwnPath, transformMarkdownUrl } from "@/app/lib/markdown-links";
import { extractHeadings } from "@/app/lib/wiki-headings";
import { isWikiAttachmentPath } from "@/app/lib/wiki-upload";
import { remarkWikiBlocks } from "@/app/lib/wiki-remark";
import { readTicketKey } from "@/app/lib/wiki-ticket-summaries";

import type { PluggableList } from "unified";
import type { Components } from "react-markdown";
import type { WikiHeading } from "@/app/lib/wiki-headings";
import type { WikiCalloutKind } from "@/app/lib/wiki-remark";

interface WikiMarkdownProps {
  /** Markdown source of the page; raw HTML in it is shown as text. */
  readonly source: string;
  readonly className?: string;
  /** Optional text annotations supplied by a consuming view. */
  readonly rehypePlugins?: PluggableList;
  /**
   * Tells whether an image may be shown; wiki attachments by default, ticket
   * descriptions also allow their own attachments.
   */
  readonly isDisplayableImage?: (src: string) => boolean;
  /**
   * Makes the images controls that open the viewer. The text then forms the
   * set of images the viewer pages through.
   */
  readonly onOpenImage?: (image: HTMLImageElement) => void;
  /**
   * Shows ticket links as pills with status and a ticket alone on its line
   * as a card, as on wiki pages. The markdown keeps the plain links.
   */
  readonly hasTicketPills?: boolean;
}

/** The parts of a markdown syntax tree node that the ticket block reads. */
interface TicketBlockNode {
  type: string;
  url?: string;
  value?: string;
  children?: TicketBlockNode[];
  data?: { hProperties?: Record<string, string> };
}

/**
 * The address of the ticket a paragraph links to when the link is all it
 * holds, the markdown of a ticket block (`[KEY](/tasks/KEY)` on its own line).
 */
function readSoleTicketLink(paragraph: TicketBlockNode): string | null {
  const content = (paragraph.children ?? []).filter(
    (child) => child.type !== "text" || (child.value ?? "").trim() !== "",
  );
  const [link] = content;

  return content.length === 1 &&
    link?.type === "link" &&
    link.url !== undefined &&
    readTicketKey(link.url) !== null
    ? link.url
    : null;
}

/** Marks the top-level paragraphs that are ticket blocks. */
function remarkTicketBlocks(): (tree: TicketBlockNode) => void {
  return (tree) => {
    for (const node of tree.children ?? []) {
      const path = node.type === "paragraph" ? readSoleTicketLink(node) : null;

      if (path !== null) {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, dataTicketBlock: path },
        };
      }
    }
  };
}

const REMARK_PLUGINS = [...MARKDOWN_REMARK_PLUGINS, remarkWikiBlocks];
const TICKET_REMARK_PLUGINS = [...REMARK_PLUGINS, remarkTicketBlocks];

function TableOfContents({
  headings,
}: {
  readonly headings: readonly WikiHeading[];
}): React.ReactElement {
  return (
    <nav className="my-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <ul className="space-y-1">
        {headings.map((heading) => (
          <li
            key={heading.id}
            style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}
          >
            <a className="text-primary hover:underline" href={`#${heading.id}`}>
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Callout({
  kind,
  children,
}: {
  readonly kind: WikiCalloutKind;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const { className, icon: Icon } = CALLOUT_STYLES[kind];

  return (
    <div
      className={cn("mt-3 flex gap-3 rounded-lg border p-3", className)}
      role="note"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A link that tells the images inside it where it leads; the provider sits
 * outside the link, which keeps the link's own children as they are.
 */
const linkOfImages: Components["a"] = ({ href, children }) => (
  <ImageLinkContext value={href === undefined || href === "" ? null : href}>
    <MarkdownLink href={href}>{children}</MarkdownLink>
  </ImageLinkContext>
);

/**
 * Puts the ticket pill in place of a ticket link and renders every other
 * link as usual.
 */
function TicketOrLink({
  href,
  hasImageViewer,
  children,
}: {
  readonly href?: string;
  readonly hasImageViewer: boolean;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const path = href === undefined ? undefined : toOwnPath(href);
  const key = path === undefined ? null : readTicketKey(path);

  if (path !== undefined && key !== null) {
    return (
      <TicketPill path={path} ticketKey={key}>
        {children}
      </TicketPill>
    );
  }

  return hasImageViewer ? (
    <ImageLinkContext value={href === undefined || href === "" ? null : href}>
      <MarkdownLink href={href}>{children}</MarkdownLink>
    </ImageLinkContext>
  ) : (
    <MarkdownLink href={href}>{children}</MarkdownLink>
  );
}

const ticketLink: Components["a"] = ({ href, children }) => (
  <TicketOrLink hasImageViewer={false} href={href}>
    {children}
  </TicketOrLink>
);

const ticketLinkOfImages: Components["a"] = ({ href, children }) => (
  <TicketOrLink hasImageViewer href={href}>
    {children}
  </TicketOrLink>
);

/** A paragraph that is a ticket block becomes the ticket card. */
const ticketParagraph: Components["p"] = ({ children, node }) => {
  const path = node?.properties.dataTicketBlock;
  const key = typeof path === "string" ? readTicketKey(path) : null;

  return typeof path === "string" && key !== null ? (
    <TicketCard path={path} ticketKey={key} />
  ) : (
    <p className="mt-2 first:mt-0">{children}</p>
  );
};

interface ComponentOptions {
  readonly headings: readonly WikiHeading[];
  readonly isDisplayableImage: (src: string) => boolean;
  /** Whether the images are controls of an image viewer. */
  readonly hasImageViewer: boolean;
  readonly hasTicketPills: boolean;
}

function createComponents({
  headings,
  isDisplayableImage,
  hasImageViewer,
  hasTicketPills,
}: ComponentOptions): Components {
  const idByLine = new Map(
    headings.map((heading) => [heading.line, heading.id]),
  );
  const heading =
    (Tag: "h1" | "h2" | "h3", className: string): Components["h1"] =>
    ({ children, node }) => (
      <Tag
        className={cn("scroll-mt-5 font-semibold text-foreground", className)}
        id={idByLine.get(Number(node?.position?.start.line))}
      >
        {children}
      </Tag>
    );

  const ticketComponents: Components = {
    a: hasImageViewer ? ticketLinkOfImages : ticketLink,
    p: ticketParagraph,
  };

  return {
    ...MARKDOWN_COMPONENTS,
    ...(hasImageViewer ? { a: linkOfImages } : {}),
    ...(hasTicketPills ? ticketComponents : {}),
    blockquote: ({ children, ...props }) => {
      const kind = (props as Record<string, unknown>)["data-wiki-callout"];

      return isCalloutKind(kind) ? (
        <Callout kind={kind}>{children}</Callout>
      ) : (
        <blockquote className="mt-2 border-l-2 border-border pl-3 italic">
          {children}
        </blockquote>
      );
    },
    details: ({ children }) => (
      <details className="mt-3 rounded-lg border border-border px-3 py-2">
        {children}
      </details>
    ),
    h1: heading("h1", "mt-8 text-2xl first:mt-0"),
    h2: heading("h2", "mt-6 text-xl first:mt-0"),
    h3: heading("h3", "mt-5 text-lg first:mt-0"),
    img: ({ alt, src }) =>
      typeof src === "string" && isDisplayableImage(src) ? (
        <MarkdownImage alt={alt} src={src} />
      ) : null,
    nav: () => <TableOfContents headings={headings} />,
    summary: ({ children }) => (
      <summary className="cursor-pointer font-medium text-foreground">
        {children}
      </summary>
    ),
  };
}

/**
 * Renders the markdown text of a wiki page as safe markup.
 *
 * @remarks
 * Shares the ticket renderer: no raw HTML runs, links keep to http, https,
 * mailto and relative targets. On top of it come heading anchors, callouts,
 * collapsible blocks, a table of contents for `[toc]`, and images, which are
 * only shown when they are wiki attachments of this instance.
 */
export function WikiMarkdown({
  source,
  className,
  isDisplayableImage = isWikiAttachmentPath,
  onOpenImage,
  rehypePlugins,
  hasTicketPills = false,
}: WikiMarkdownProps): React.ReactElement {
  const hasImageViewer = onOpenImage !== undefined;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // The map is built once per text. Components that change identity on every
  // render would make React rebuild the whole rendered text, images included.
  const components = useMemo(
    () =>
      createComponents({
        headings: extractHeadings(source),
        isDisplayableImage,
        hasImageViewer,
        hasTicketPills,
      }),
    [source, isDisplayableImage, hasImageViewer, hasTicketPills],
  );

  return (
    <div
      ref={setContainer}
      className={cn(
        "pages-selectable text-sm leading-relaxed break-words",
        className,
      )}
      data-viewer-scope={hasImageViewer ? "" : undefined}
    >
      <ImageOpenContext value={onOpenImage ?? null}>
        <Markdown
          components={components}
          rehypePlugins={rehypePlugins}
          remarkPlugins={
            hasTicketPills ? TICKET_REMARK_PLUGINS : REMARK_PLUGINS
          }
          urlTransform={transformMarkdownUrl}
        >
          {source}
        </Markdown>
      </ImageOpenContext>
      {hasTicketPills ? <TicketPreviewLayer container={container} /> : null}
    </div>
  );
}
