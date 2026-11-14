import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

/** Sets the agent's optional monthly Codex equivalent-cost limit, including subscription usage. */
export function CodexCostLimitField(props: {
  readonly limit: number | undefined;
  readonly onChange: (limit: number | undefined) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">{t("codexUsage.monthlyLimit")}</span>
      <Input
        type="number"
        min={0}
        step="any"
        value={props.limit ?? ""}
        onChange={(event) =>
          props.onChange(
            event.target.value === "" ? undefined : event.target.valueAsNumber,
          )
        }
      />
      <span className="block text-xs font-normal text-muted-foreground">
        {t("codexUsage.monthlyLimitHint")}
      </span>
    </label>
  );
}
