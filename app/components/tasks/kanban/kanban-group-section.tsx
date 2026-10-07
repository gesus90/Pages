import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { BoardGroupSection } from "@/app/lib/board-groups";

interface KanbanGroupSectionProps {
  readonly section: BoardGroupSection;
  readonly children: React.ReactNode;
}

/**
 * Names a section of the grouped board.
 *
 * @param section - The section to name.
 * @param translate - Translates a key of the task texts.
 */
function sectionTitle(
  section: BoardGroupSection,
  translate: (key: string) => string,
): string {
  if (section.kind === "priority") {
    return translate(`tasks.priority.${section.key}`);
  }

  return section.title ?? translate(`tasks.groupEmpty.${section.kind}`);
}

/** Renders the heading and the status columns of one group of the kanban board. */
export function KanbanGroupSection({
  section,
  children,
}: KanbanGroupSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2
        className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-foreground"
        id={headingId}
      >
        {sectionTitle(section, t)}
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
          {section.items.length}
        </span>
      </h2>
      {/* The lane is as tall as its fullest column up to a cap, and every column stretches to it; taller columns scroll inside. */}
      <div className="pages-hover-scrollbar overflow-x-auto overflow-y-hidden pb-2">
        <div className="flex max-h-[34rem] w-max min-w-full items-stretch gap-4 px-1 md:gap-5 [&>section]:h-auto">
          {children}
        </div>
      </div>
    </section>
  );
}
