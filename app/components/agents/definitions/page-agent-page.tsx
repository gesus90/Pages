import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { PageContent } from "@/app/components/ui/card";

import { PageAgentEditor } from "./page-agent-editor";

import type { PageAgent, PageAgentPage } from "@/definition/PageAgent";

function sharingLabel(agent: PageAgent): string {
  if (agent.configuration.sharing.isGlobal) return "pageAgents.global";
  return agent.configuration.sharing.targets.length
    ? "pageAgents.restricted"
    : "pageAgents.private";
}

/** User agent management shares the application cards and the existing template/parameter controls. */
export function PageAgentPageView({
  page,
}: {
  readonly page: PageAgentPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PageAgent | null | undefined>(
    undefined,
  );
  function edit(agent: PageAgent): void {
    setSelected(agent);
  }
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("navigation.agentList")}</h1>
        <Button
          onClick={() => setSelected(null)}
          disabled={page.models.length === 0}
        >
          {t("pageAgents.create")}
        </Button>
      </div>
      {page.models.length === 0 ? (
        <p role="status" className="text-muted-foreground">
          {t("pageAgents.noModels")}
        </p>
      ) : null}
      {selected !== undefined ? (
        <PageAgentEditor
          key={selected?.id ?? "new"}
          agent={selected}
          page={page}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
      {page.agents.length === 0 ? (
        <p className="text-muted-foreground">{t("pageAgents.empty")}</p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {page.agents.map((agent) => (
          <PageContent key={agent.id} className="space-y-3 p-4">
            <h2 className="break-words text-lg font-semibold">{agent.name}</h2>
            <p className="text-sm text-muted-foreground">
              {agent.model} ·{" "}
              {agent.reasoningEffort ?? t("pageAgents.defaultReasoning")}
            </p>
            <p className="text-sm">{t(sharingLabel(agent))}</p>
            {!agent.availability.isUsable ? (
              <p role="status" className="text-sm text-warning">
                {t("pageAgents.blocked")}
              </p>
            ) : null}
            <Button variant="outline" onClick={() => edit(agent)}>
              {t(agent.canEdit ? "pageAgents.edit" : "pageAgents.view")}
            </Button>
          </PageContent>
        ))}
      </div>
    </main>
  );
}
