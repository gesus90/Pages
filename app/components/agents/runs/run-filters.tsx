import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import {
  EMPTY_RUN_FILTERS,
  ERROR_CLASSES,
  RUN_STATUSES,
} from "./run-diagnosis-model";

import type { RunDiagnosisPlans, RunFilters } from "./run-diagnosis-model";

function Field({
  label,
  children,
  htmlFor,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly htmlFor?: string;
}): React.ReactElement {
  return (
    <div className="min-w-40 flex-1 space-y-1">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** The selects of the filters: plan, status and error class. */
function SelectFilters({
  filters,
  plans,
  set,
}: {
  readonly filters: RunFilters;
  readonly plans: RunDiagnosisPlans | null;
  readonly set: (patch: Partial<RunFilters>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("runDiagnosis.filters.plan")}>
        <Select
          size="sm"
          value={filters.planId}
          onValueChange={(planId) => set({ planId })}
          ariaLabel={t("runDiagnosis.filters.plan")}
          options={[
            { value: "", label: t("runDiagnosis.filters.allPlans") },
            ...(plans?.plans ?? []).map((plan) => ({
              value: plan.id,
              label: `${plan.projectName} · ${plan.name}`,
            })),
          ]}
        />
      </Field>
      <Field label={t("runDiagnosis.filters.status")}>
        <Select
          size="sm"
          value={filters.status}
          onValueChange={(status) => set({ status })}
          ariaLabel={t("runDiagnosis.filters.status")}
          options={[
            { value: "", label: t("runDiagnosis.filters.allStatuses") },
            ...RUN_STATUSES.map((status) => ({
              value: status,
              label: t(`runDiagnosis.status.${status}`),
            })),
          ]}
        />
      </Field>
      <Field label={t("runDiagnosis.filters.errorClass")}>
        <Select
          size="sm"
          value={filters.errorClass}
          onValueChange={(errorClass) => set({ errorClass })}
          ariaLabel={t("runDiagnosis.filters.errorClass")}
          options={[
            { value: "", label: t("runDiagnosis.filters.allErrorClasses") },
            ...ERROR_CLASSES.map((errorClass) => ({
              value: errorClass,
              label: t(`runDiagnosis.errorClass.${errorClass}.label`),
            })),
          ]}
        />
      </Field>
    </>
  );
}

/** The step and time filters. */
function TextFilters({
  filters,
  set,
}: {
  readonly filters: RunFilters;
  readonly set: (patch: Partial<RunFilters>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const stepId = useId();
  const fromId = useId();
  const toId = useId();
  return (
    <>
      <Field label={t("runDiagnosis.filters.step")} htmlFor={stepId}>
        <Input
          id={stepId}
          value={filters.stepId}
          placeholder={t("runDiagnosis.filters.stepPlaceholder")}
          onChange={(event) => set({ stepId: event.target.value.trim() })}
        />
      </Field>
      <Field label={t("runDiagnosis.filters.from")} htmlFor={fromId}>
        <Input
          id={fromId}
          type="date"
          value={filters.from}
          onChange={(event) => set({ from: event.target.value })}
        />
      </Field>
      <Field label={t("runDiagnosis.filters.to")} htmlFor={toId}>
        <Input
          id={toId}
          type="date"
          value={filters.to}
          onChange={(event) => set({ to: event.target.value })}
        />
      </Field>
    </>
  );
}

/** The filters of the run list and the failure overview: time, status, plan, step, error class and starter. */
export function RunFiltersForm({
  filters,
  plans,
  onChange,
}: {
  readonly filters: RunFilters;
  readonly plans: RunDiagnosisPlans | null;
  readonly onChange: (filters: RunFilters) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isMine = plans !== null && filters.startedById === plans.userId;
  function set(patch: Partial<RunFilters>): void {
    onChange({ ...filters, ...patch });
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={t("runDiagnosis.filters.title")}
      onSubmit={(event) => event.preventDefault()}
    >
      <SelectFilters filters={filters} plans={plans} set={set} />
      <TextFilters filters={filters} set={set} />
      <div className="flex items-center gap-2 pb-1">
        <Button
          type="button"
          size="sm"
          variant={isMine ? "default" : "outline"}
          aria-pressed={isMine}
          disabled={plans === null}
          onClick={() =>
            set({ startedById: isMine ? "" : (plans?.userId ?? "") })
          }
        >
          {t("runDiagnosis.filters.onlyMine")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange(EMPTY_RUN_FILTERS)}
        >
          {t("runDiagnosis.filters.reset")}
        </Button>
      </div>
    </form>
  );
}
