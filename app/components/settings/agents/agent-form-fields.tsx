import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { AGENT_PROVIDERS, isAgentProvider } from "@/definition/AgentConnection";

import { AgentModelField } from "./agent-model-field";

import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { AgentAccessKind } from "@/definition/AgentConnection";
import type { AgentModelAvailability } from "./use-model-availability";
import type { AgentForm } from "./use-agent-form";

function AgentKeyField({
  form,
  isExisting,
}: {
  readonly form: AgentForm;
  readonly isExisting: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isReplacing, setIsReplacing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const hasError =
    form.error === "api_key_required" ||
    form.error === "api_key_invalid_format";
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">
        {t("settings.agents.credentials")}
      </h3>
      {isExisting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("settings.agents.keyStored")}
          </span>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setIsReplacing(true)}
          >
            {t("settings.agents.replaceKey")}
          </Button>
        </div>
      ) : null}
      {!isExisting || isReplacing ? (
        <div className="space-y-2">
          <label htmlFor="agent-api-key" className="text-sm font-medium">
            {t("settings.agents.apiKey")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="agent-api-key"
              type={isVisible ? "text" : "password"}
              value={form.fields.apiKey}
              onChange={(event) => form.setField("apiKey", event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              maxLength={512}
              required={!isExisting}
              aria-invalid={hasError}
              aria-describedby={hasError ? "agent-key-error" : "agent-key-hint"}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t(
                isVisible
                  ? "settings.agents.hideKey"
                  : "settings.agents.showKey",
              )}
              onClick={() => setIsVisible(!isVisible)}
            >
              {isVisible ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <p id="agent-key-hint" className="text-xs text-muted-foreground">
            {t(
              isExisting
                ? "settings.agents.replaceKeyHint"
                : "settings.agents.keyHint",
            )}
          </p>
          {hasError ? (
            <p id="agent-key-error" className="text-xs text-destructive">
              {t(`settings.agents.error.${form.error}`)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Renders editable metadata and an input-only credential field. */
export function AgentFormFields({
  form,
  kind,
  catalog,
  availability,
}: {
  readonly form: AgentForm;
  readonly kind: AgentAccessKind;
  readonly catalog?: AgentModelCatalog;
  readonly availability: AgentModelAvailability;
}): React.ReactElement {
  const isExisting = availability.isExisting;
  const { t } = useTranslation();
  const hasNameError =
    form.error === "name_required" ||
    form.error === "name_too_long" ||
    form.error === "name_taken";
  const options = Object.keys(AGENT_PROVIDERS)
    .filter(isAgentProvider)
    .filter((provider) => AGENT_PROVIDERS[provider].accessKind === kind)
    .map((provider) => ({
      value: provider,
      label: t(AGENT_PROVIDERS[provider].labelKey),
    }));
  return (
    <fieldset disabled={form.isSaving} className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">
          {t("settings.agents.general")}
        </h3>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="agent-name">
            {t("settings.agents.name")}
          </label>
          <Input
            id="agent-name"
            required
            maxLength={80}
            value={form.fields.name}
            onChange={(event) => form.setField("name", event.target.value)}
            aria-invalid={hasNameError}
            aria-describedby={hasNameError ? "agent-name-error" : undefined}
          />
          {hasNameError ? (
            <p id="agent-name-error" className="text-xs text-destructive">
              {t(`settings.agents.error.${form.error}`)}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="agent-provider">
            {t("settings.agents.providerLabel")}
          </label>
          <Select
            id="agent-provider"
            value={form.fields.provider}
            options={options}
            onValueChange={(provider) => form.setField("provider", provider)}
            disabled={isExisting || form.isSaving}
            ariaLabel={t("settings.agents.providerLabel")}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.accessLabel")}:{" "}
          {t(`settings.agents.access.${kind}`)}
        </p>
      </section>
      {kind === "api_key" ? (
        <AgentKeyField
          key={form.savedCount}
          form={form}
          isExisting={isExisting}
        />
      ) : null}
      <AgentModelField
        form={form}
        catalog={catalog}
        availability={availability}
      />
    </fieldset>
  );
}
