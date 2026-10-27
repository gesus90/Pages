import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Textarea } from "@/app/components/ui/textarea";

import type { AgentPlanStep } from "@/definition/AgentPlan";

/** An explicit, versioned opt-in separate from diagnostic progress. */
export function PlanCompletionGateField({
  step,
  onChange,
}: {
  readonly step: AgentPlanStep;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const gate = step.completionGate;
  function toggle(): void {
    if (gate) {
      const { completionGate: previous, ...rest } = step;
      if (!previous) return;
      onChange(rest);
      return;
    }
    onChange({
      ...step,
      completion: "todos",
      completionGate: {
        version: 1,
        requiredChecks: ["pnpm run check", "pnpm run lint"],
      },
    });
  }
  function changeChecks(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    const requiredChecks = [
      ...new Set(
        event.target.value
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
    onChange({
      ...step,
      completion: "todos",
      completionGate: { version: 1, requiredChecks },
    });
  }
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <Checkbox checked={gate !== undefined} onChange={toggle} />
        {t("plans.workGate.label")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t("plans.workGate.hint")}
      </p>
      {gate ? (
        <label className="block space-y-1">
          <span>{t("plans.workGate.checks")}</span>
          <Textarea
            key={step.id}
            defaultValue={gate.requiredChecks.join("\n")}
            onBlur={changeChecks}
            rows={4}
            required
          />
        </label>
      ) : null}
    </div>
  );
}
