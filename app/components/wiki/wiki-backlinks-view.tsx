import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiBacklinks } from "@/definition/Wiki";

/**
 * The section "Mentioned in" below the text, above attachments and
 * subpages: pages, tickets and projects that link to this page and that the
 * person may see.
 */
export function WikiBacklinksView({
  backlinks,
}: {
  readonly backlinks: WikiBacklinks;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const entries = [
    ...backlinks.pages.map((page) => ({
      key: `page:${page.id}`,
      kind: "backlinkPage",
      label: page.title,
      to: wikiPagePath(page.id, page.title),
    })),
    ...backlinks.tickets.map((ticket) => ({
      key: `ticket:${ticket.id}`,
      kind: "backlinkTicket",
      label: `${ticket.key} ${ticket.title}`,
      to: `/aufgaben/${ticket.key}`,
    })),
    ...backlinks.projects.map((project) => ({
      key: `project:${project.id}`,
      kind: "backlinkProject",
      label: project.name,
      to: `/projekte/${project.id}`,
    })),
  ];

  return entries.length === 0 ? null : (
    <section
      aria-label={t("wiki.page.backlinks")}
      className="border-t border-border pt-4 text-sm"
    >
      <h2 className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
        {t("wiki.page.backlinks")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              className="rounded-full bg-muted px-2.5 py-1 text-xs text-primary hover:underline"
              title={t(`wiki.page.${entry.kind}`)}
              to={entry.to}
            >
              {entry.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
