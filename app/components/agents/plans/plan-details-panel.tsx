import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Tabs, TabsContent } from "@/app/components/ui/tabs";
import { cn } from "@/app/lib/cn";

import { PlanConnections } from "./plan-connections";
import { PlanRunView } from "./plan-run-view";
import { PlanStatusBadge } from "./plan-status";

import type { usePlanEditor } from "./use-plan-editor";
import type { usePlanRun } from "./use-plan-run";

/**
 * The collapsible panel below the grid with the details of a real run and the connection list.
 *
 * @remarks
 * Without a run it shows the empty state of the run view; it never fills in
 * steps, sessions or errors that no run recorded.
 */
export function PlanDetailsPanel(props: {
  readonly state: ReturnType<typeof usePlanRun>;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly hasRuns: boolean;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(props.hasRuns);
  const [tab, setTab] = useState("run");
  const { run } = props.state;
  const { editor } = props;
  const Chevron = isOpen ? ChevronDown : ChevronUp;
  return (
    <section
      aria-label={t("plans.detailsPanel")}
      className={cn(
        "flex max-h-[45%] min-h-0 flex-col rounded-xl border border-border bg-surface/95 shadow-panel backdrop-blur",
        props.className,
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="plan-details-body"
        onClick={() => setOpen(!isOpen)}
        className="flex min-h-10 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <Chevron className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {t("plans.detailsPanel")}
        </span>
        {run ? <PlanStatusBadge compact status={run.status} /> : null}
        <span className="sr-only">
          {t(isOpen ? "plans.collapseDetails" : "plans.expandDetails")}
        </span>
      </button>
      <div
        id="plan-details-body"
        hidden={!isOpen}
        className="min-h-0 flex-1 overflow-y-auto border-t border-border p-3"
      >
        <Tabs
          value={tab}
          onValueChange={setTab}
          ariaLabel={t("plans.detailsPanel")}
          tabs={[
            { value: "run", label: t("plans.runView") },
            { value: "connections", label: t("plans.dependencies") },
          ]}
        >
          <TabsContent value="run" className="pt-3">
            <PlanRunView
              state={props.state}
              isPending={editor.isPending}
              onStop={editor.stop}
            />
          </TabsContent>
          <TabsContent value="connections" className="pt-3">
            <PlanConnections
              draft={editor.draft}
              sources={editor.sources}
              graph={editor.graph}
              disabled={!editor.canEdit || editor.isPending}
            />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
