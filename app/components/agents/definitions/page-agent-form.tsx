import { useTranslation } from "react-i18next";

import { AgentAssignmentResult } from "@/app/components/settings/agents/agent-assignment-result";
import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";
import { AgentTemplateEditor } from "@/app/components/settings/agents/agent-template-editor";
import { Button } from "@/app/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import {
  isAcpPermissionMode,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import { agentParameterIssues } from "@/definition/AgentParameters";

import { PageAgentModelFields } from "./page-agent-model-fields";
import { PageAgentSharing } from "./page-agent-sharing";
import { usePageAgentForm } from "./use-page-agent-form";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  PageAgent,
  PageAgentInput,
  PageAgentPage,
} from "@/definition/PageAgent";

/** What the form derives from the draft: the chosen model's provider and whether it can be saved. */
interface PageAgentFormState {
  readonly hasModel: boolean;
  readonly provider: AgentProviderId | null;
  readonly isInvalid: boolean;
}

/**
 * Checks the draft before it is saved.
 *
 * @remarks
 * A Codex CLI or Claude Code agent saved with the earlier write mode must
 * choose one of its two modes first.
 */
function formState(
  input: PageAgentInput,
  agent: PageAgent | null,
  models: PageAgentPage["models"],
): PageAgentFormState {
  const model = models.find((entry) => entry.id === input.modelProfileId);
  const provider = model?.provider ?? agent?.provider ?? null;
  const { run } = input.configuration;
  const isModeMissing =
    provider !== null &&
    isAcpProvider(provider) &&
    run !== undefined &&
    !isAcpPermissionMode(run.access);
  return {
    hasModel: model !== undefined,
    provider,
    isInvalid:
      !input.name.trim() ||
      model === undefined ||
      isModeMissing ||
      agentParameterIssues(input.configuration).length > 0,
  };
}

function PageAgentFormActions(props: {
  readonly isReadOnly: boolean;
  readonly isPending: boolean;
  readonly isInvalid: boolean;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        disabled={props.isPending}
        onClick={props.onClose}
      >
        {t(props.isReadOnly ? "pageAgents.close" : "settings.agents.cancel")}
      </Button>
      {props.isReadOnly ? null : (
        <Button type="submit" disabled={props.isPending || props.isInvalid}>
          {t("pageAgents.save")}
        </Button>
      )}
    </div>
  );
}

/** Edits a definition; the form names only an administrator model, never a connection or a credential. */
export function PageAgentForm(props: {
  readonly agent: PageAgent | null;
  readonly page: PageAgentPage;
  readonly onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const form = usePageAgentForm(props.agent, props.page.models, props.onSaved);
  const { input, fetcher, isPending } = form;
  const isReadOnly = props.agent?.canEdit === false;
  const isDisabled = isReadOnly || isPending;
  const { hasModel, provider, isInvalid } = formState(
    input,
    props.agent,
    props.page.models,
  );
  let title = "pageAgents.create";
  if (props.agent)
    title = isReadOnly ? "pageAgents.viewAgent" : "pageAgents.editAgent";
  return (
    <DialogContent
      size="lg"
      className="flex h-[90dvh] w-[min(64rem,92vw)] flex-col"
      onEscapeKeyDown={form.guardDismiss}
      onPointerDownOutside={form.guardDismiss}
    >
      <DialogTitle className="text-lg font-semibold">{t(title)}</DialogTitle>
      <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
        {t(
          isReadOnly ? "pageAgents.readOnlyHint" : "pageAgents.formDescription",
        )}
      </DialogDescription>
      <fetcher.Form
        method="post"
        action="/agents/agents"
        className="mt-5 flex min-h-0 flex-1 flex-col"
      >
        <input type="hidden" name="intent" value="save-agent" />
        <input type="hidden" name="agentId" value={props.agent?.id ?? ""} />
        <input type="hidden" name="agent" value={JSON.stringify(input)} />
        <VerticalScrollArea
          className="min-h-0 flex-1"
          contentClassName="space-y-5 px-1 pt-1 pb-10"
        >
          <label className="block space-y-2 text-sm font-medium">
            <span>{t("pageAgents.name")}</span>
            <Input
              value={input.name}
              maxLength={200}
              disabled={isDisabled}
              onChange={(event) =>
                form.setInput({ ...input, name: event.target.value })
              }
            />
          </label>
          <PageAgentModelFields
            draft={input}
            models={props.page.models}
            disabled={isDisabled}
            isModelWithdrawn={!isReadOnly && !hasModel}
            onChange={form.setInput}
          />
          <AgentTemplateEditor
            configuration={input.configuration}
            provider={provider}
            workspaceChoices={props.page.workspaces}
            disabled={isDisabled}
            onChange={(configuration) =>
              form.setInput({ ...input, configuration })
            }
          />
          <PageAgentSharing
            configuration={input.configuration}
            directory={props.page.directory}
            disabled={isDisabled}
            hasDeletedTargets={
              !isReadOnly && (props.agent?.hasDeletedTargets ?? false)
            }
            onChange={(configuration) =>
              form.setInput({ ...input, configuration })
            }
          />
          <AgentAssignmentResult result={fetcher.data} />
        </VerticalScrollArea>
        <PageAgentFormActions
          isReadOnly={isReadOnly}
          isPending={isPending}
          isInvalid={isInvalid}
          onClose={form.requestClose}
        />
      </fetcher.Form>
      <AgentDiscardDialog
        open={form.shouldConfirmClose}
        onOpenChange={form.setConfirmClose}
        onDiscard={props.onSaved}
      />
    </DialogContent>
  );
}
