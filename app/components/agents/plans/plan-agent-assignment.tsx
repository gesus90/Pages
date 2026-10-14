import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";

/** Repairs a removed definition or explicit model grant without replacing the plan node or its bindings. */
export function PlanAgentAssignment(props: {
  readonly step: AgentPlanStep;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  const agent = props.sources.agents.find((entry) => entry.id === step.agentId);
  const isPersonalMissing = step.personalAgentId === "";
  return (
    <div className="space-y-3">
      {!agent ? (
        <div className="space-y-1">
          <p role="status" className="text-sm text-warning">
            {t("plans.missingAgent")}
          </p>
          <Select
            ariaLabel={t("plans.assignAgent")}
            value=""
            disabled={props.disabled}
            options={[
              { value: "", label: t("plans.assignAgent"), disabled: true },
              ...props.sources.agents.map((entry) => ({
                value: entry.id,
                label: entry.name,
              })),
            ]}
            onValueChange={(agentId) =>
              props.onChange({ ...step, agentId, personalAgentId: null })
            }
          />
        </div>
      ) : null}
      {agent?.configuration.accessMode === "personal" ? (
        <div className="space-y-1">
          {isPersonalMissing ? (
            <p role="status" className="text-sm text-warning">
              {t("plans.missingPersonalAccess")}
            </p>
          ) : null}
          <label className="text-sm" htmlFor="plan-personal-access">
            {t("plans.personalAccess")}
          </label>
          <Select
            id="plan-personal-access"
            ariaLabel={t("plans.personalAccess")}
            value={step.personalAgentId ?? ""}
            disabled={props.disabled}
            options={[
              {
                value: "",
                label: t(
                  isPersonalMissing
                    ? "plans.assignPersonalAccess"
                    : "plans.uniquePersonalAccess",
                ),
                disabled: isPersonalMissing,
              },
              ...agent.availability.personalChoices.map((choice) => ({
                value: choice.id,
                label: choice.name,
              })),
            ]}
            onValueChange={(personalAgentId) =>
              props.onChange({
                ...step,
                personalAgentId: personalAgentId || null,
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}
