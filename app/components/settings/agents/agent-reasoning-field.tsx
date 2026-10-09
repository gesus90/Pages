import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { AgentForm } from "./use-agent-form";

/** Why no effort can be chosen when the model offers no listed levels. */
function reasoningNoteKey(
  model: AgentCatalogModel | undefined,
  isCliDefault: boolean,
): string {
  if (model) return `settings.agents.reasoning.${model.reasoning}`;
  return isCliDefault
    ? "settings.agents.reasoning.cliDefault"
    : "settings.agents.reasoning.manual";
}

/**
 * Offers only the efforts the provider or CLI lists for the selected model.
 *
 * @remarks
 * A level saved before the list changed stays visible as such until it is
 * reset, so the form never hides the value that model tests still use.
 */
export function AgentReasoningField({
  form,
  model,
  isCliDefault,
}: {
  readonly form: AgentForm;
  readonly model: AgentCatalogModel | undefined;
  readonly isCliDefault: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const efforts = model?.reasoning === "levels" ? model.reasoningEfforts : [];
  const saved = form.fields.reasoningEffort;
  const isUnlisted = saved !== "" && !efforts.includes(saved);
  const note =
    efforts.length > 0
      ? "settings.agents.reasoning.hint"
      : reasoningNoteKey(model, isCliDefault);
  if (efforts.length === 0 && !isUnlisted)
    return <p className="text-xs text-muted-foreground">{t(note)}</p>;
  const options = [
    {
      value: "",
      label: model?.defaultReasoningEffort
        ? t("settings.agents.reasoning.defaultNamed", {
            effort: model.defaultReasoningEffort,
          })
        : t("settings.agents.reasoning.default"),
    },
    ...efforts.map((effort) => ({ value: effort, label: effort })),
    ...(isUnlisted
      ? [
          {
            value: saved,
            label: t("settings.agents.reasoning.unlisted", { effort: saved }),
          },
        ]
      : []),
  ];
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="agent-reasoning">
        {t("settings.agents.reasoning.label")}
      </label>
      <Select
        id="agent-reasoning"
        value={saved}
        options={options}
        ariaLabel={t("settings.agents.reasoning.label")}
        onValueChange={(effort) => form.setField("reasoningEffort", effort)}
        disabled={form.isSaving}
        className="w-full"
      />
      <p className="text-xs text-muted-foreground">{t(note)}</p>
    </div>
  );
}
