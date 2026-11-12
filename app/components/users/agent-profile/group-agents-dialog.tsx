import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { ManagementTable } from "@/app/components/users/management-table";

import { AgentProfilePanel } from "./agent-profile-panel";
import { isAgentProfileList } from "./agent-profile-guards";
import { useProfileEndpoint } from "./use-profile-endpoint";

import type { AgentProfileListItem } from "@/definition/AgentProfileRead";
import type { ManagedGroup } from "@/definition/UserGroup";

interface GroupAgentsDialogProps {
  /** The group whose agents to show; `null` keeps the dialog closed. */
  readonly group: ManagedGroup | null;
  readonly onClose: () => void;
}

/** One agent: name, role, short description, model and workload. */
function AgentOverviewRow({
  agent,
  onOpen,
}: {
  readonly agent: AgentProfileListItem;
  readonly onOpen: (agentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <tr className="hover:bg-muted/40">
      <td className="px-4 py-3">
        <Button
          variant="link"
          onClick={() => onOpen(agent.id)}
          aria-label={t("agentProfile.open", { name: agent.displayName })}
        >
          {agent.displayName}
        </Button>
      </td>
      <td className="pages-selectable px-4 py-3">{agent.role ?? "—"}</td>
      <td className="pages-selectable max-w-64 px-4 py-3 text-muted-foreground">
        {agent.summary ?? "—"}
      </td>
      <td className="pages-selectable px-4 py-3">
        {agent.model?.model ?? "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {t("agentProfile.load", {
          chats: agent.activeChats,
          steps: agent.runningSteps,
          tickets: agent.openTickets,
        })}
      </td>
    </tr>
  );
}

/**
 * The agents of a group for its leaders and administrators (PAGE-308):
 * name, role, short description, model and workload. A click opens the
 * read-only profile.
 */
export function GroupAgentsDialog({
  group,
  onClose,
}: GroupAgentsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const url =
    group === null
      ? null
      : `/users-api/groups/${encodeURIComponent(group.id)}/agents`;
  const {
    data: overview,
    isLoading,
    errorCode,
  } = useProfileEndpoint(url, isAgentProfileList);
  return (
    <>
      <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent size="lg" className="w-[min(60rem,94vw)]">
          <DialogTitle className="text-lg font-semibold">
            {t("agentProfile.groupTitle", { name: group?.name ?? "" })}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">
            {t("agentProfile.groupHint")}
          </DialogDescription>
          <div className="mt-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">
                {t("agentProfile.loading")}
              </p>
            ) : null}
            {errorCode === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {t("agentProfile.unavailable")}
              </p>
            )}
            {overview === null ? null : (
              <ManagementTable>
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    {["name", "role", "summary", "model", "workload"].map(
                      (column) => (
                        <th key={column} className="px-4 py-3 font-medium">
                          {t(`agentProfile.columns.${column}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {overview.agents.map((agent) => (
                    <AgentOverviewRow
                      key={agent.id}
                      agent={agent}
                      onOpen={setOpenAgentId}
                    />
                  ))}
                </tbody>
              </ManagementTable>
            )}
            {overview !== null && overview.agents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("agentProfile.none")}
              </p>
            ) : null}
          </div>
          <footer className="mt-6 flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost">{t("agentProfile.close")}</Button>
            </DialogClose>
          </footer>
        </DialogContent>
      </Dialog>
      <AgentProfilePanel
        agentId={openAgentId}
        onClose={() => setOpenAgentId(null)}
      />
    </>
  );
}
