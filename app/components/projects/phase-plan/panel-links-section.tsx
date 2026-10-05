import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MilestoneSearchSelect } from "@/app/components/projects/phase-plan/milestone-search-select";
import { MilestoneSymbol } from "@/app/components/projects/phase-plan/milestone-symbol";
import { Button } from "@/app/components/ui/button";
import { MILESTONE_ICON } from "@/definition/Task";

import type {
  LinkCandidate,
  WorkingLink,
} from "@/app/lib/phase-plan/plan-types";

interface PanelLinksSectionProps {
  readonly candidates: readonly LinkCandidate[];
  readonly links: readonly WorkingLink[];
  readonly onAdd: (target: LinkCandidate) => void;
  readonly onRemove: (linkId: string) => void;
}

/** Renders the dependency list of the panel with a picker for new targets. */
export function PanelLinksSection({
  candidates,
  links,
  onAdd,
  onRemove,
}: PanelLinksSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [target, setTarget] = useState<LinkCandidate | null>(null);

  function handleAdd(chosen: LinkCandidate): void {
    onAdd(chosen);
    setTarget(null);
  }

  return (
    <div className="flex flex-col gap-2 text-sm font-medium">
      <span className="select-none">
        {t("projectDetail.planning.phasePlan.dependencies")}
      </span>
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-medium text-muted-foreground">
          {t("projectDetail.planning.phasePlan.linkWith")}
        </span>
        <MilestoneSearchSelect
          options={candidates}
          selectedId={target?.id ?? null}
          onSelect={setTarget}
          choosePlaceholder={t("projectDetail.planning.phasePlan.linkChoose")}
          searchPlaceholder={t("projectDetail.planning.phasePlan.linkSearch")}
        />
      </div>
      <Button
        className="h-9 w-full bg-primary-subtle text-xs font-semibold text-primary hover:bg-primary-subtle hover:opacity-80"
        type="button"
        disabled={target === null}
        onClick={target ? () => handleAdd(target) : undefined}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {t("projectDetail.planning.phasePlan.addLink")}
      </Button>
      {links.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs"
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-md"
                style={{
                  backgroundColor: `${link.targetHex}26`,
                  color: link.targetHex,
                }}
                aria-hidden="true"
              >
                <MilestoneSymbol
                  icon={link.targetIcon ?? MILESTONE_ICON.DIAMOND}
                  className="size-3.5 shrink-0"
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {link.targetName}
              </span>
              <button
                type="button"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={link.targetName}
                onClick={() => onRemove(link.id)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
