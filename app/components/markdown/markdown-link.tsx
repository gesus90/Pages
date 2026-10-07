import { BookOpen, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { isWikiPath, toOwnPath } from "@/app/lib/markdown-links";

interface MarkdownLinkProps {
  readonly href?: string;
  readonly children?: React.ReactNode;
}

const LINK_CLASS =
  "rounded-sm font-medium text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Origin of this application, known only after hydration so that the server
 * and the first client render agree.
 */
function useOwnOrigin(): string | undefined {
  const [origin, setOrigin] = useState<string | undefined>(undefined);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return origin;
}

/** A link inside the application; Wiki pages carry a book icon. */
function InAppLink({
  path,
  children,
}: {
  readonly path: string;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const isWiki = isWikiPath(path);

  return (
    <Link
      className={LINK_CLASS}
      data-link-kind={isWiki ? "wiki" : "internal"}
      to={path}
    >
      {isWiki ? (
        <BookOpen
          aria-label={t("markdown.wikiLink")}
          className="mr-1 inline size-3.5 align-[-0.125em]"
          role="img"
        />
      ) : null}
      {children}
    </Link>
  );
}

/**
 * A link of rendered markdown: Wiki and in-app targets use the router, other
 * targets open in a new tab without handing over the opener.
 */
export function MarkdownLink({
  href,
  children,
}: MarkdownLinkProps): React.ReactElement {
  const { t } = useTranslation();
  const ownOrigin = useOwnOrigin();

  if (!href) {
    return <span>{children}</span>;
  }

  if (href.startsWith("mailto:")) {
    return (
      <a className={LINK_CLASS} data-link-kind="mail" href={href}>
        {children}
      </a>
    );
  }

  const ownPath = toOwnPath(href, ownOrigin);

  if (ownPath !== undefined) {
    return <InAppLink path={ownPath}>{children}</InAppLink>;
  }

  return (
    <a
      className={LINK_CLASS}
      data-link-kind="external"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
      <ExternalLink
        aria-label={t("markdown.externalLink")}
        className="ml-1 inline size-3 align-[-0.1em]"
        role="img"
      />
    </a>
  );
}
