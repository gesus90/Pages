import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

import type { AgentParameter } from "@/definition/AgentParameters";

/** Keeps an empty numeric default absent; malformed numeric drafts are refused before saving or starting. */
export function AgentNumberDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  const number =
    parameter.defaultValue?.type === "number"
      ? parameter.defaultValue.number
      : null;
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">
        {t("settings.agents.definition.defaultValue")}
      </span>
      <Input
        type="number"
        step="any"
        value={number !== null && Number.isFinite(number) ? number : ""}
        onChange={(event) =>
          props.onChange({
            ...parameter,
            defaultValue:
              event.target.value === "" && !event.target.validity.badInput
                ? null
                : { type: "number", number: event.target.valueAsNumber },
          })
        }
      />
    </label>
  );
}
