import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import { AgentAssignmentResult } from "./agent-assignment-result";

import type { TextAssistantSettings } from "@/definition/TextAssistant";
import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";

/** Retention is independent of function assignments and personal preferences. */
export function TextAgentSettings({
  settings,
}: {
  readonly settings: TextAssistantSettings;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const isPending = fetcher.state !== "idle";
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <h2 className="font-semibold">
        {t("assistant.settings.retentionTitle")}
      </h2>
      <fetcher.Form
        action="/settings/agents"
        method="post"
        className="space-y-4"
      >
        <input type="hidden" name="intent" value="configure-retention" />
        <div className="space-y-2">
          <label
            htmlFor="assistant-retention"
            className="block text-sm font-medium"
          >
            {t("assistant.settings.retention")}
          </label>
          <Input
            id="assistant-retention"
            name="retentionDays"
            type="number"
            min={1}
            max={365}
            required
            defaultValue={settings.retentionDays}
            disabled={isPending}
          />
        </div>
        <AgentAssignmentResult result={fetcher.data} />
        <Button type="submit" disabled={isPending}>
          {t("assistant.settings.save")}
        </Button>
      </fetcher.Form>
    </section>
  );
}
