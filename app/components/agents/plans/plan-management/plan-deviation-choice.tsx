import { useId } from "react";
import { useTranslation } from "react-i18next";

type DeviationChoice = "keep" | "follow";

/** The explicit decision for nodes whose own target differs from the new plan target. */
export function PlanDeviationChoice(props: {
  readonly names: readonly string[];
  readonly choice: DeviationChoice | null;
  readonly onChoose: (choice: DeviationChoice) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const titleId = useId();
  const shown = props.names.slice(0, 5);
  return (
    <div
      role="radiogroup"
      aria-labelledby={titleId}
      aria-required="true"
      className="space-y-2 rounded-xl bg-warning-subtle px-4 py-3 text-xs"
    >
      <p id={titleId} className="font-semibold text-warning">
        {t("plans.manage.deviationTitle")}
      </p>
      <p className="wrap-anywhere text-foreground">
        {t("plans.manage.deviationNodes", {
          count: props.names.length,
          names: shown.join(", "),
        })}
      </p>
      {(["keep", "follow"] as const).map((option) => (
        <label
          key={option}
          className="flex items-start gap-2 text-foreground [@media(pointer:coarse)]:min-h-11"
        >
          <input
            type="radio"
            name="plan-target-deviation"
            value={option}
            checked={props.choice === option}
            onChange={() => props.onChoose(option)}
          />
          <span>{t(`plans.manage.deviation.${option}`)}</span>
        </label>
      ))}
    </div>
  );
}
