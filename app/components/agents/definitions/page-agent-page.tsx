import { Bot, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { useManagementPending } from "@/app/components/users/use-management-pending";

import { PageAgentForm } from "./page-agent-form";
import { PageAgentRow } from "./page-agent-row";

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
