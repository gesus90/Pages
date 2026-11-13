import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import {
  firstPlanLocation,
  planLocationOptions,
  planProjects,
} from "./plan-context-model";
import { planTeamName } from "./plan-access-model";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { PlanContextValues } from "./plan-context-model";

/** The only field visible before the simple settings disclosure is opened. */
export function PlanSettingsName(props: {
  readonly name: string;
  readonly isReadOnly: boolean;
  readonly onChange: (name: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {t("plans.manage.nameLabel")}
      <Input
        value={props.name}
        maxLength={120}
        readOnly={props.isReadOnly}
        className="border-field-border bg-field"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

/** Collapsed by default; context and teams remain one concise line until requested. */
export function PlanSettingsOptions(props: {
  readonly page: AgentPlanPage;
  readonly values: PlanContextValues;
  readonly teams: readonly AgentPlanTeam[];
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = planLocationOptions(props.page, props.values.projectId, t);
  const location =
    options.find((entry) => entry.value === props.values.location) ??
    options.find((entry) => !entry.disabled);
  const names = props.teams
    .map((team) => planTeamName(props.page.directory, team))
    .join(", ");
  const summary = [
    location?.label ?? t("plans.manage.noLocation"),
    names || t("plans.access.noTeams"),
  ].join(" · ");
  return (
    <details className="group space-y-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground">
        <ChevronRight
          className="size-4 shrink-0 group-open:rotate-90"
          aria-hidden="true"
        />
        <span>{t("plans.manage.moreOptions")}</span>
        <span className="ml-auto truncate text-[13px]" title={summary}>
          {summary}
        </span>
      </summary>
      <div className="ml-2 border-l-2 border-border pl-[22px] space-y-5">
        {props.children}
      </div>
    </details>
  );
}

/** The project and workspace selection shared by the two compact settings dialogs. */
export function PlanSettingsContext(props: {
  readonly page: AgentPlanPage;
  readonly values: PlanContextValues;
  readonly isDisabled: boolean;
  readonly isProjectFixed: boolean;
  readonly hasProject: boolean;
  readonly onChange: (values: PlanContextValues) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = planLocationOptions(props.page, props.values.projectId, t);
  function changeProject(projectId: string): void {
    props.onChange({
      ...props.values,
      projectId,
      location: firstPlanLocation(
        planLocationOptions(props.page, projectId, t),
      ),
    });
  }
  return (
    <div
      className={
        props.hasProject
          ? "grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr]"
          : "grid gap-3"
      }
    >
      {props.hasProject ? (
        <label className="grid content-start gap-1.5 text-sm font-semibold">
          {t("workspaces.project")}
          <Select
            ariaLabel={t("workspaces.project")}
            value={props.values.projectId}
            options={planProjects(props.page)}
            disabled={props.isDisabled || props.isProjectFixed}
            onValueChange={changeProject}
            className="w-full min-w-0 bg-field [&>span]:truncate"
          />
          {props.isProjectFixed ? (
            <span className="text-xs font-normal text-muted-foreground">
              {t("plans.manage.projectOwnerOnly")}
            </span>
          ) : null}
        </label>
      ) : null}
      <label className="grid content-start gap-1.5 text-sm font-semibold">
        {t("plans.panel.workspace")}
        <Select
          ariaLabel={t("plans.panel.workspace")}
          value={
            options.some((entry) => entry.value === props.values.location)
              ? props.values.location
              : firstPlanLocation(options)
          }
          options={options}
          disabled={props.isDisabled}
          onValueChange={(location) =>
            props.onChange({ ...props.values, location })
          }
          placeholder={t("plans.manage.noLocation")}
          className="w-full min-w-0 bg-field [&>span]:truncate"
        />
      </label>
    </div>
  );
}
