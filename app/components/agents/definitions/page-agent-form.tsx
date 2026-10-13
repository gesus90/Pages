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
import { agentParameterIssues } from "@/definition/AgentParameters";

import { PageAgentModelFields } from "./page-agent-model-fields";
import { PageAgentSharing } from "./page-agent-sharing";
import { usePageAgentForm } from "./use-page-agent-form";

import type { PageAgent, PageAgentPage } from "@/definition/PageAgent";

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
  const hasModel = props.page.models.some(
    (model) => model.id === input.modelProfileId,
  );
  const isInvalid =
    !input.name.trim() ||
    !hasModel ||
    agentParameterIssues(input.configuration).length > 0;
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
            onChange={form.setInput}
          />
          <AgentTemplateEditor
            configuration={input.configuration}
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
