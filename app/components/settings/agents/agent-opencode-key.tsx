import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  isOpenCodeKeyProvider,
  OPENCODE_KEY_PROVIDERS,
} from "@/definition/AgentConnection";

import type {
  AgentConnectionSummary,
  OpenCodeKeyProvider,
} from "@/definition/AgentConnection";
import type { AgentActions } from "./use-agent-actions";
import type { FormEvent } from "react";

function savedProvider(
  connection: AgentConnectionSummary,
): OpenCodeKeyProvider {
  const provider = connection.cli?.accountLabel?.toLowerCase();
  if (isOpenCodeKeyProvider(provider)) return provider;
  const modelProvider = connection.testModel?.split("/")[0];
  return isOpenCodeKeyProvider(modelProvider) ? modelProvider : "opencode";
}

/** Takes a native provider ID and its OpenCode key; the key never comes back to the page. */
export function AgentOpenCodeKey({
  connection,
  actions,
  disabled,
}: {
  readonly connection: AgentConnectionSummary;
  readonly actions: AgentActions;
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [modelProvider, setModelProvider] = useState(savedProvider(connection));
  useEffect(() => {
    if (actions.result?.ok && actions.result.intent === "store-cli-key")
      setApiKey("");
  }, [actions.result]);
  const hasError =
    actions.pendingIntent === null &&
    actions.result?.ok === false &&
    actions.result.intent === "store-cli-key";
  function submitKey(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    actions.submit("store-cli-key", connection.id, { apiKey, modelProvider });
  }
  return (
    <form onSubmit={submitKey} className="space-y-2">
      <label
        className="block text-sm font-medium"
        htmlFor="agent-opencode-provider"
      >
        {t("settings.agents.openCodeProvider")}
      </label>
      <Select
        id="agent-opencode-provider"
        value={modelProvider}
        onValueChange={setModelProvider}
        options={OPENCODE_KEY_PROVIDERS.map((provider) => ({
          value: provider,
          label: t(`settings.agents.openCodeKeyProvider.${provider}`),
        }))}
        disabled={disabled}
        ariaLabel={t("settings.agents.openCodeProvider")}
      />
      <label className="block text-sm font-medium" htmlFor="agent-opencode-key">
        {t("settings.agents.openCodeKey")}
      </label>
      <Input
        id="agent-opencode-key"
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        autoComplete="new-password"
        spellCheck={false}
        maxLength={512}
        pattern="[^\s\p{Cc}]+"
        required
        aria-invalid={hasError}
        aria-describedby="agent-opencode-key-hint"
      />
      <p id="agent-opencode-key-hint" className="text-xs text-muted-foreground">
        {t("settings.agents.openCodeKeyHint")}
      </p>
      <Button
        type="submit"
        size="sm"
        disabled={disabled || !apiKey.trim() || !modelProvider}
      >
        {t(
          connection.cli?.loggedInAt
            ? "settings.agents.openCodeKeyReplace"
            : "settings.agents.openCodeKeyStore",
        )}
      </Button>
    </form>
  );
}
