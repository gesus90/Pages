import { Monitor, Server } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import {
  firstPlanLocation,
  planLocationOptions,
  planProjects,
} from "./plan-context-model";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { PlanContextValues } from "./plan-context-model";

const LABEL_CLASS = "text-sm font-semibold";
/** Filled fields as on the other forms of Pages; a white field disappears on the white dialog. */
const FIELD_CLASS = "border border-field-border bg-field";

interface PlanContextFieldsProps {
  readonly page: AgentPlanPage;
  readonly values: PlanContextValues;
  readonly onChange: (values: PlanContextValues) => void;
  readonly isDisabled: boolean;
  /** Only the owner moves a plan to another project. */
  readonly isProjectFixed: boolean;
  /** Why the name cannot be used, as a translated sentence. */
  readonly nameError: string | null;
}

/**
 * Plan name, project and location: one selection of the project's local and
 * remote workspaces.
 *
 * @remarks
 * The chosen location is named below the selection: the Pages host, or the
 * runner of a remote workspace and its directory.
 */
export function PlanContextFields(
  props: PlanContextFieldsProps,
): React.ReactElement {
  const { t } = useTranslation();
  const nameId = useId();
  const nameMessageId = useId();
  const projectId = useId();
  const locationId = useId();
  const { page, values } = props;
  const options = planLocationOptions(page, values.projectId, t);
  const chosen = options.find((option) => option.value === values.location);
  function changeProject(id: string): void {
    props.onChange({
      ...values,
      projectId: id,
      location: firstPlanLocation(planLocationOptions(page, id, t)),
    });
  }
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor={nameId} className={`block ${LABEL_CLASS}`}>
          {t("plans.panel.name")}
        </label>
        <Input
          id={nameId}
          value={values.name}
          maxLength={120}
          autoComplete="off"
          placeholder={t("plans.manage.namePlaceholder")}
          disabled={props.isDisabled}
          aria-invalid={props.nameError !== null}
          aria-describedby={props.nameError ? nameMessageId : undefined}
          className={FIELD_CLASS}
          onChange={(event) =>
            props.onChange({ ...values, name: event.target.value })
          }
        />
        {props.nameError ? (
          <p
            id={nameMessageId}
            role="alert"
            className="text-xs text-destructive"
          >
            {props.nameError}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <label htmlFor={projectId} className={`block ${LABEL_CLASS}`}>
          {t("workspaces.project")}
        </label>
        <Select
          id={projectId}
          size="default"
          ariaLabel={t("workspaces.project")}
          value={values.projectId}
          options={planProjects(page)}
          onValueChange={changeProject}
          disabled={props.isDisabled || props.isProjectFixed}
          className={cn("w-full min-w-0 [&>span]:truncate", FIELD_CLASS)}
        />
        {props.isProjectFixed && !props.isDisabled ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.manage.projectOwnerOnly")}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <label htmlFor={locationId} className={`block ${LABEL_CLASS}`}>
          {t("plans.panel.workspace")}
        </label>
        <Select
          id={locationId}
          size="default"
          ariaLabel={t("plans.panel.workspace")}
          value={values.location}
          options={options.map((option) => ({
            ...option,
            icon:
              option.kind === "remote" ? (
                <Server aria-hidden="true" className="size-4" />
              ) : (
                <Monitor aria-hidden="true" className="size-4" />
              ),
          }))}
          placeholder={t("plans.manage.noLocation")}
          onValueChange={(location) => props.onChange({ ...values, location })}
          disabled={props.isDisabled || options.length === 0}
          className={cn("w-full min-w-0 [&>span]:truncate", FIELD_CLASS)}
        />
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {chosen ? chosen.hint : t("plans.manage.noLocationHint")}
        </p>
      </div>
    </div>
  );
}
