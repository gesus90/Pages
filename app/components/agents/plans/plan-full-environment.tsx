import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";

import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import type { AgentRunAccess } from "@/definition/AgentConfiguration";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";

/** Server-derived administrator permission and the plan owner's display name. */
export const PlanFullEnvironmentContext = createContext({
  canSelect: false,
  ownerName: "",
});

/** Supplies permission to every node editor, including nodes in groups and loops. */
export function PlanFullEnvironmentProvider({
  page,
  children,
}: {
  readonly page: AgentPlanPage;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const ownerId = page.selected?.ownerId ?? page.userId;
  const ownerName =
    page.directory.persons.find((person) => person.id === ownerId)?.name ??
    ownerId;
  return (
    <PlanFullEnvironmentContext.Provider
      value={{ canSelect: page.isAdministrator === true, ownerName }}
    >
      {children}
    </PlanFullEnvironmentContext.Provider>
  );
}

/** Explicit host-risk notice, visible to every reader of a configured node or run. */
export function PlanFullEnvironmentNotice({
  ownerName,
}: {
  readonly ownerName?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const context = useContext(PlanFullEnvironmentContext);
  return (
    <p
      role="note"
      className="text-xs font-medium text-warning"
      title={t("plans.fullEnvironment.risk")}
    >
      {t("plans.fullEnvironment.access", {
        owner: ownerName ?? context.ownerName,
      })}
    </p>
  );
}

/** Keeps the running step's frozen owner warning visible even when the run panel is collapsed. */
export function PlanFullEnvironmentRunNotice({
  run,
}: {
  readonly run: AgentPlanRun | null;
}): React.ReactElement | null {
  const owners = new Set(
    (run ? allPlanRunResults(run) : [])
      .filter(
        (step) =>
          step.status === "running" &&
          step.session?.requested.options?.access === "full_environment",
      )
      .map((step) => step.session?.effective?.fullEnvironmentOwner),
  );
  if (!owners.size) return null;
  return (
    <div className="space-y-1 px-3 py-2">
      {[...owners].map((owner) => (
        <PlanFullEnvironmentNotice key={owner ?? "owner"} ownerName={owner} />
      ))}
    </div>
  );
}

/** Shows the full owner grant and its risk outside the editor's collapsed advanced settings. */
export function PlanFullEnvironmentEditorNotice({
  access,
}: {
  readonly access: AgentRunAccess | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (access !== "full_environment") return null;
  return (
    <div className="space-y-1">
      <PlanFullEnvironmentNotice />
      <p className="text-xs text-warning">{t("plans.fullEnvironment.risk")}</p>
    </div>
  );
}
