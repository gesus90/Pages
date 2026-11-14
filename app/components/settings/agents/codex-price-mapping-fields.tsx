import { useTranslation } from "react-i18next";

import type { AgentForm } from "./use-agent-form";

/** Public price-ID overrides for each model of this Codex connection. */
export function CodexPriceMappingFields({
  form,
}: {
  readonly form: AgentForm;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (form.fields.provider !== "codex_cli") return null;
  return (
    <section className="space-y-2">
      <label
        htmlFor="codex-price-mappings"
        className="block text-sm font-medium"
      >
        {t("codexUsage.mappings")}
      </label>
      <textarea
        id="codex-price-mappings"
        className="min-h-24 w-full rounded-md border border-input bg-surface p-2 text-sm"
        value={form.fields.codexPriceMappings ?? ""}
        onChange={(event) =>
          form.setField("codexPriceMappings", event.target.value)
        }
        aria-describedby="codex-price-mappings-hint"
        maxLength={100_000}
        spellCheck={false}
      />
      <p
        id="codex-price-mappings-hint"
        className="text-xs text-muted-foreground"
      >
        {t("codexUsage.mappingsHint")}
      </p>
    </section>
  );
}
