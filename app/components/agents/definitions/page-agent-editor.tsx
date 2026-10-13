import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { PageContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { AgentTemplateEditor } from "@/app/components/settings/agents/agent-template-editor";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { agentParameterIssues } from "@/definition/AgentParameters";

import { PageAgentSharing } from "./page-agent-sharing";
import { PageAgentModelFields } from "./page-agent-model-fields";

import type {
  PageAgent,
  PageAgentInput,
  PageAgentPage,
} from "@/definition/PageAgent";

/** Owner editor submits a complete definition, with a revision guard and no credential fields. */
export function PageAgentEditor(props: {
  readonly agent: PageAgent | null;
  readonly page: PageAgentPage;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    readonly ok?: boolean;
    readonly error?: string;
  }>();
  const first = props.page.models[0];
  const [draft, setDraft] = useState<PageAgentInput>(
    props.agent ?? {
      name: "",
      modelProfileId: first?.id ?? "",
      reasoningEffort: first?.reasoningEffort ?? null,
      configuration: { ...emptyAgentConfiguration(), accessMode: "shared" },
    },
  );
  const model = props.page.models.find(
    (entry) => entry.id === draft.modelProfileId,
  );
  const isReadOnly = props.agent?.canEdit === false;
  const isDisabled = isReadOnly || fetcher.state !== "idle";
  const canSave =
    Boolean(model && draft.name.trim()) &&
    agentParameterIssues(draft.configuration).length === 0;
  const { onClose } = props;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  function save(): void {
    void fetcher.submit(
      {
        intent: "save-agent",
        agentId: props.agent?.id ?? "",
        agent: JSON.stringify(draft),
      },
      { method: "post" },
    );
  }
  return (
    <PageContent className="space-y-5 p-4 sm:p-6">
      <label className="block space-y-2 text-sm font-medium">
        <span>{t("pageAgents.name")}</span>
        <Input
          value={draft.name}
          maxLength={200}
          disabled={isDisabled}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <PageAgentModelFields
        draft={draft}
        models={props.page.models}
        disabled={isDisabled}
        onChange={setDraft}
      />
      <AgentTemplateEditor
        configuration={draft.configuration}
        workspaceChoices={props.page.workspaces}
        disabled={isDisabled}
        onChange={(configuration) => setDraft({ ...draft, configuration })}
      />
      <PageAgentSharing
        configuration={draft.configuration}
        directory={props.page.directory}
        disabled={isDisabled}
        onChange={(configuration) => setDraft({ ...draft, configuration })}
      />
      {fetcher.data?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.errors.${fetcher.data.error}`, {
            defaultValue: t("pageAgents.saveFailed"),
          })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={props.onClose}
          disabled={fetcher.state !== "idle"}
        >
          {t("pageAgents.close")}
        </Button>
        {!isReadOnly ? (
          <Button onClick={save} disabled={isDisabled || !canSave}>
            {t("pageAgents.save")}
          </Button>
        ) : null}
      </div>
    </PageContent>
  );
}
