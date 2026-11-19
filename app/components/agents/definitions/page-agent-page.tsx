import { Bot, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";

import { AgentAssignmentResult } from "@/app/components/settings/agents/agent-assignment-result";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button, buttonVariants } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { useManagementPending } from "@/app/components/users/use-management-pending";

import { PageAgentForm } from "./page-agent-form";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { PageAgent, PageAgentPage } from "@/definition/PageAgent";

const COLUMNS = ["name", "model", "reasoning", "sharing", "status", "actions"];

function PageAgentTable(props: {
  readonly agents: readonly PageAgent[];
  readonly onOpen: (agent: PageAgent) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="px-4 py-3">
                {t(`pageAgents.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {props.agents.map((agent) => (
            <PageAgentRow
              key={agent.id}
              agent={agent}
              onOpen={() => props.onOpen(agent)}
            />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}

function PageAgentList(props: {
  readonly agents: readonly PageAgent[];
  readonly isLoading: boolean;
  readonly onOpen: (agent: PageAgent) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.isLoading)
    return (
      <div
        role="status"
        aria-label={t("pageAgents.loading")}
        className="flex flex-col gap-4 py-2"
      >
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-4 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  if (props.agents.length === 0)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("pageAgents.empty")}
      </p>
    );
  return <PageAgentTable agents={props.agents} onOpen={props.onOpen} />;
}

/** Lists the agents visible to the person and opens them in the same form that creates one. */
export function PageAgentPageView({
  page,
}: {
  readonly page: PageAgentPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const isLoading = useManagementPending();
  const [selected, setSelected] = useState<PageAgent | "new" | null>(null);
  const hasModels = page.models.length > 0;
  function close(): void {
    setSelected(null);
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-2 pt-3 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("navigation.agentList")}</h1>
        {page.isAdministrator ? (
          <Link
            to="/settings/agents"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("navigation.agentManagement")}
          </Link>
        ) : null}
      </header>
      <SettingsCard
        icon={<Bot className="size-5" />}
        title={t("pageAgents.listTitle")}
        description={t("pageAgents.description")}
        wrapHeader
        action={
          <Button
            size="sm"
            disabled={!hasModels}
            onClick={() => setSelected("new")}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("pageAgents.create")}
          </Button>
        }
      >
        {hasModels ? null : (
          <p role="status" className="mb-4 text-sm text-warning">
            {t("pageAgents.noModels")}
          </p>
        )}
        <PageAgentList
          agents={page.agents}
          isLoading={isLoading}
          onOpen={setSelected}
        />
      </SettingsCard>
      {/* The form guards every dismissal itself, so it asks before it drops a draft. */}
      <Dialog open={selected !== null}>
        {selected === null ? null : (
          <PageAgentForm
            key={selected === "new" ? "new" : selected.id}
            agent={selected === "new" ? null : selected}
            page={page}
            onSaved={close}
          />
        )}
      </Dialog>
    </div>
  );
}

function PageAgentDelete(props: {
  readonly agent: PageAgent;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const { onClose } = props;
  const isPending = fetcher.state !== "idle";
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "delete-agent"
    )
      onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  function close(): void {
    if (!isPending) onClose();
  }
  return (
    <Dialog open onOpenChange={close}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("pageAgents.deleteTitle", { name: props.agent.name })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t("pageAgents.deleteDescription")}
        </DialogDescription>
        <AgentAssignmentResult result={fetcher.data} />
        <fetcher.Form
          method="post"
          action="/agents/agents"
          className="mt-6 flex justify-end gap-2"
        >
          <input type="hidden" name="intent" value="delete-agent" />
          <input type="hidden" name="agentId" value={props.agent.id} />
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={close}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={isPending}>
            {t("pageAgents.confirmDelete")}
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function sharingLabel(agent: PageAgent): string {
  const { sharing } = agent.configuration;
  if (sharing.isGlobal) return "pageAgents.global";
  return sharing.targets.length > 0
    ? "pageAgents.restricted"
    : "pageAgents.private";
}

function PageAgentRow(props: {
  readonly agent: PageAgent;
  readonly onOpen: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isDeleting, setDeleting] = useState(false);
  const { agent } = props;
  const { reason } = agent.availability;
  const status =
    reason === null
      ? t("pageAgents.ready")
      : t(`settings.agents.error.${reason}`, {
          defaultValue: t(`agentExecution.error.${reason}`),
        });
  return (
    <tr>
      <th scope="row" className="pages-selectable px-4 py-3 font-medium">
        {agent.name}
      </th>
      <td className="pages-selectable px-4 py-3">{agent.model}</td>
      <td className="pages-selectable px-4 py-3">
        {agent.reasoningEffort ?? t("pageAgents.defaultReasoning")}
      </td>
      <td className="px-4 py-3">{t(sharingLabel(agent))}</td>
      <td className="px-4 py-3">
        <span
          className={
            agent.availability.isUsable ? "text-success" : "text-warning"
          }
        >
          {status}
        </span>
      </td>
      <td className="px-4 py-3">
        <Button size="sm" variant="outline" onClick={props.onOpen}>
          {t(agent.canEdit ? "pageAgents.edit" : "pageAgents.view")}
        </Button>
        {agent.canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-2"
            onClick={() => setDeleting(true)}
          >
            {t("settings.agents.remove")}
          </Button>
        ) : null}
        {isDeleting ? (
          <PageAgentDelete agent={agent} onClose={() => setDeleting(false)} />
        ) : null}
      </td>
    </tr>
  );
}
