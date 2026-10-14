import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { planLinkKey, planLinkLabel, planLinks } from "./plan-links";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

/** A readable list of every connection: an accessible alternative to selecting and removing arrows. */
export function PlanConnections(props: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph } = props;
  const links = planLinks(props.draft);
  const selectedKey = graph.selectedLink
    ? planLinkKey(graph.selectedLink)
    : null;
  return (
    <section aria-label={t("plans.dependencies")} className="space-y-2">
      <h2 className="text-sm font-semibold">{t("plans.dependencies")}</h2>
      <ul className="space-y-1">
        {links.map((link) => {
          const key = planLinkKey(link);
          const name = planLinkLabel(props.draft, props.sources, link);
          return (
            <li key={key} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                aria-pressed={key === selectedKey}
                className={cn(
                  "text-left hover:underline",
                  key === selectedKey && "font-semibold underline",
                )}
                onClick={() => graph.selectLink(link)}
              >
                {name} · {t(`plans.linkKind.${link.kind}`)}
              </button>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.disabled}
                aria-label={t("plans.removeLink", { name })}
                onClick={() => graph.disconnect(link)}
              >
                {t("plans.unlink")}
              </Button>
            </li>
          );
        })}
      </ul>
      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.noDependencies")}
        </p>
      ) : null}
    </section>
  );
}
