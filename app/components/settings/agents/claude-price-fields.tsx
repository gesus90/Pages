import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import type { AgentForm } from "./use-agent-form";

/** Explicit per-model overrides for unresolved Claude catalog identities. Blank entries use automatic matching. */
export function ClaudePriceFields({
  form,
}: {
  readonly form: AgentForm;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [model, setModel] = useState("");
  if (form.fields.provider !== "claude_code") return null;
  const mappings = z
    .record(z.string(), z.string())
    .parse(JSON.parse(form.fields.claudePriceModels ?? "{}"));
  const models = [
    ...new Set([...Object.keys(mappings), form.fields.testModel, model]),
  ].filter(Boolean);
  function setMapping(key: string, id: string): void {
    const next = { ...mappings };
    if (id.trim()) next[key] = id.trim();
    else delete next[key];
    form.setField("claudePriceModels", JSON.stringify(next));
  }
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">
        {t("settings.agents.claudePrices.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.claudePrices.hint")}
      </p>
      {models.map((key) => (
        <label key={key} className="block space-y-1 text-sm">
          <span>{key}</span>
          <Input
            value={mappings[key] ?? ""}
            placeholder="anthropic/claude-haiku-5.5"
            maxLength={200}
            onChange={(event) => setMapping(key, event.target.value)}
          />
        </label>
      ))}
      <label className="block space-y-1 text-sm">
        <span>{t("settings.agents.claudePrices.model")}</span>
        <Input
          value={model}
          maxLength={200}
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      {model && mappings[model] ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setModel("")}
        >
          {t("settings.agents.claudePrices.another")}
        </Button>
      ) : null}
    </section>
  );
}
