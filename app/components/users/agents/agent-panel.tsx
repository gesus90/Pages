import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { SidePanelContent } from "@/app/components/ui/side-panel";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersActionData,
  useUsersError,
} from "@/app/components/users/use-users-action";

import { AgentActivitySection } from "./agent-activity-section";
import {
  AgentInstructionsSection,
  AgentSoulSection,
} from "./agent-document-section";
import { agentDraftPayload, createAgentDraft } from "./agent-draft";
import { AgentGeneralSection } from "./agent-general-section";
import { AgentMemorySection } from "./agent-memory-section";
import { useAgentDetail } from "./use-agent-detail";

import type { AgentDetailState } from "./use-agent-detail";
import type { AgentEmployee } from "@/definition/AgentEmployee";
import type { UsersErrorCode } from "@/app/lib/user-actions/user-action-support.server";

import type { AgentDraft, AgentDraftChange } from "./agent-draft";
import type { AgentEmployeeDetailData } from "@/definition/AgentEmployeePage";
import type { Department, UserRole } from "@/definition/Authorization";
import type { PageAgentModel } from "@/definition/PageAgent";

interface AgentPanelProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The agent to edit; `null` creates a new one. */
  readonly agentId: string | null;
  readonly models: readonly PageAgentModel[];
  readonly roles: readonly UserRole[];
  readonly departments: readonly Department[];
}

/** The draft of the panel and the picked image, reset whenever the agent is read anew. */
function useAgentPanelDraft(
  detail: AgentEmployeeDetailData | null,
  defaults: { readonly roleId: string; readonly soul: string },
): {
  readonly draft: AgentDraft;
  readonly change: AgentDraftChange;
  readonly image: File | null;
  readonly setImage: (file: File) => void;
  readonly imagePreview: string | null;
} {
  const [draft, setDraft] = useState(() =>
    createAgentDraft(detail?.agent ?? null, defaults),
  );
  const [image, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);
  const agent = detail?.agent ?? null;
  const version = agent
    ? `${agent.id}:${agent.revision}:${agent.memory.length}`
    : "new";
  useEffect(() => {
    if (loaded.current === version) return;
    loaded.current = version;
    setDraft(createAgentDraft(agent, defaults));
    setImageFile(null);
  }, [version, agent, defaults]);
  useEffect(() => {
    if (!image) {
      setImagePreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const change: AgentDraftChange = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return { draft, change, image, setImage: setImageFile, imagePreview };
}

/** Reads the agent again after one of its memory versions was restored. */
function useReloadAfterRestore(): number {
  const result = useUsersActionData();
  const [reloadKey, setReloadKey] = useState(0);
  const previous = useRef(result);
  useEffect(() => {
    if (result === previous.current) return;
    previous.current = result;
    if (result?.intent === "restore-agent-memory" && result.ok)
      setReloadKey((key) => key + 1);
  }, [result]);
  return reloadKey;
}

/** Everything the panel shows and does. */
interface AgentPanelState {
  readonly isEditing: boolean;
  readonly loaded: AgentDetailState;
  readonly panel: ReturnType<typeof useAgentPanelDraft>;
  readonly agent: AgentEmployee | null;
  readonly isSubmitting: boolean;
  readonly isDisabled: boolean;
  readonly error: UsersErrorCode | null;
  readonly restoreError: UsersErrorCode | null;
  readonly save: () => void;
}

/** Derives the panel state from the agent and the draft. */
function useAgentPanel(props: AgentPanelProps): AgentPanelState {
  const { t } = useTranslation();
  const submit = useSubmit();
  const isEditing = props.agentId !== null;
  const intent = isEditing ? "update-agent" : "create-agent";
  const reloadKey = useReloadAfterRestore();
  const loaded = useAgentDetail(props.isOpen ? props.agentId : null, reloadKey);
  const [defaults] = useState(() => ({
    roleId: props.roles.at(-1)?.id ?? "",
    soul: t("agentEmployees.soul.template"),
  }));
  const panel = useAgentPanelDraft(loaded.detail, defaults);
  const isSubmitting = useIsSubmitting(intent);
  const canEdit =
    !isEditing || (!loaded.isLoading && loaded.detail?.canEdit === true);
  const agent = loaded.detail?.agent ?? null;
  useCloseAfterAction(intent, () => props.onOpenChange(false));

  function save(): void {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("agent", agentDraftPayload(panel.draft, props.models, agent));
    if (agent) {
      formData.set("agentId", agent.id);
      formData.set("revision", String(agent.revision));
    }
    if (panel.image) formData.set("avatar", panel.image);
    void submit(formData, { method: "post", encType: "multipart/form-data" });
  }

  return {
    isEditing,
    loaded,
    panel,
    agent,
    isSubmitting,
    isDisabled: isSubmitting || !canEdit,
    error: useUsersError(intent),
    restoreError: useUsersError("restore-agent-memory"),
    save,
  };
}

/** The tabs of the panel with their sections. */
function AgentPanelTabs({
  props,
  state,
}: {
  readonly props: AgentPanelProps;
  readonly state: AgentPanelState;
}): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState("general");
  const { panel, agent, isDisabled } = state;
  const tabs = [
    { value: "general", label: t("agentEmployees.tabs.general") },
    { value: "soul", label: t("agentEmployees.tabs.soul") },
    { value: "instructions", label: t("agentEmployees.tabs.instructions") },
    { value: "memory", label: t("agentEmployees.tabs.memory") },
    ...(state.isEditing
      ? [{ value: "activity", label: t("agentEmployees.tabs.activity") }]
      : []),
  ];
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      tabs={tabs}
      ariaLabel={t("agentEmployees.panel.tabs")}
      className="min-h-0 flex-1 px-6"
    >
      <VerticalScrollArea
        className="mt-5 min-h-0 flex-1"
        contentClassName="pb-8 pr-1"
      >
        {state.loaded.hasFailed ? (
          <p className="text-sm text-destructive" role="alert">
            {t("agentEmployees.panel.loadFailed")}
          </p>
        ) : null}
        <TabsContent value="general">
          <AgentGeneralSection
            draft={panel.draft}
            onChange={panel.change}
            models={props.models}
            roles={props.roles}
            departments={props.departments}
            imageUrl={panel.imagePreview ?? agent?.avatarImageUrl ?? null}
            onImage={panel.setImage}
            savedModel={agent?.settings.model ?? ""}
            isDisabled={isDisabled}
          />
        </TabsContent>
        <TabsContent value="soul">
          <AgentSoulSection
            value={panel.draft.soul}
            onChange={(value) => panel.change("soul", value)}
            isDisabled={isDisabled}
          />
        </TabsContent>
        <TabsContent value="instructions">
          <AgentInstructionsSection
            value={panel.draft.instructions}
            onChange={(value) => panel.change("instructions", value)}
            isDisabled={isDisabled}
          />
        </TabsContent>
        <TabsContent value="memory">
          <AgentMemorySection
            memory={panel.draft.memory}
            onMemory={(value) => panel.change("memory", value)}
            isLearningEnabled={panel.draft.isLearningEnabled}
            onLearning={(value) => panel.change("isLearningEnabled", value)}
            agent={agent}
            details={state.loaded.detail?.memoryDetails ?? null}
            isDisabled={isDisabled}
          />
          <FormError error={state.restoreError} />
        </TabsContent>
        {agent ? (
          <TabsContent value="activity">
            <AgentActivitySection
              cost={agent.cost}
              entries={state.loaded.detail?.activity ?? []}
            />
          </TabsContent>
        ) : null}
      </VerticalScrollArea>
    </Tabs>
  );
}

/**
 * The panel "Agent erstellen" and "Agent bearbeiten" (PAGE-266): the tabs
 * Allgemein, Persönlichkeit, Aufgabe, Gedächtnis and, when editing,
 * Aktivität.
 *
 * @remarks
 * Every tab edits one draft, which is saved together; the server checks
 * role, departments, the administrator exclusion and the model again.
 */
export function AgentPanel(props: AgentPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const state = useAgentPanel(props);
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <SidePanelContent
        title={
          state.isEditing
            ? t("agentEmployees.panel.editTitle")
            : t("agentEmployees.panel.createTitle")
        }
        closeLabel={t("users.reset.close")}
      >
        <AgentPanelTabs props={props} state={state} />
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-6 py-4">
          <div className="mr-auto">
            <FormError error={state.error} />
          </div>
          <Button
            variant="ghost"
            data-panel-dismiss
            onClick={() => props.onOpenChange(false)}
          >
            {t("users.create.cancel")}
          </Button>
          <Button
            isPending={state.isSubmitting}
            disabled={state.isDisabled}
            onClick={state.save}
          >
            {state.isEditing
              ? t("agentEmployees.panel.save")
              : t("agentEmployees.panel.create")}
          </Button>
        </footer>
      </SidePanelContent>
    </Dialog>
  );
}
