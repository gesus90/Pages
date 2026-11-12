import { MoreHorizontal, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { ManagementTable } from "@/app/components/users/management-table";

import { AgentPanel } from "./agent-panel";
import { AgentDeleteDialog } from "./agent-delete-dialog";
import { AgentDeletedList } from "./agent-deleted-list";

import type { AdministrationPageData } from "@/definition/Authorization";
import type { AgentEmployeeListItem } from "@/definition/AgentEmployee";
import type { AgentEmployeePageData } from "@/definition/AgentEmployeePage";

const COLUMNS = ["agent", "username", "model", "role", "status", "actions"];

function matchesSearch(agent: AgentEmployeeListItem, query: string): boolean {
  return (
    query === "" ||
    [
      agent.displayName,
      agent.username,
      agent.position ?? "",
      agent.modelName,
    ].some((entry) => entry.toLowerCase().includes(query))
  );
}

interface AgentRowProps {
  readonly agent: AgentEmployeeListItem;
  readonly canManage: boolean;
  readonly canDelete: boolean;
  readonly onEdit: (agentId: string) => void;
  readonly onDelete: (agentId: string) => void;
}

function AgentStatus({
  isActive,
}: {
  readonly isActive: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={
          isActive
            ? "size-2 rounded-full bg-success-dot"
            : "size-2 rounded-full bg-muted-foreground/50"
        }
      />
      {t(isActive ? "users.status.active" : "agentEmployees.status.inactive")}
    </span>
  );
}

/** One agent: image with job title, username, model, role, status and actions. */
function AgentRow({
  agent,
  canManage,
  canDelete,
  onEdit,
  onDelete,
}: AgentRowProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  function setActive(isActive: boolean): void {
    const formData = new FormData();
    formData.set("intent", "set-active");
    formData.set("userId", agent.id);
    formData.set("isActive", String(isActive));
    void submit(formData, { method: "post" });
  }
  return (
    <tr className="transition-colors hover:bg-muted/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <UserAvatar
            size="sm"
            name={agent.displayName}
            avatarColor={agent.avatarColor}
            avatarType={agent.avatarImageUrl ? "image" : "initials"}
            avatarImageUrl={agent.avatarImageUrl}
          />
          <div className="flex min-w-0 flex-col">
            <span className="pages-selectable text-sm font-medium text-foreground">
              {agent.displayName}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {agent.position ?? ""}
            </span>
          </div>
        </div>
      </td>
      <td className="pages-selectable px-4 py-3 text-sm text-muted-foreground">
        {agent.username}
      </td>
      <td className="pages-selectable px-4 py-3 text-sm">{agent.modelName}</td>
      <td className="pages-selectable px-4 py-3 text-sm">
        {agent.roleName ?? "—"}
      </td>
      <td className="px-4 py-3">
        <AgentStatus isActive={agent.isActive} />
      </td>
      <td className="px-4 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("agentEmployees.actions.menu", {
                name: agent.displayName,
              })}
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(agent.id)}>
              {t(
                canManage
                  ? "agentEmployees.actions.edit"
                  : "agentEmployees.actions.view",
              )}
            </DropdownMenuItem>
            {canManage ? (
              <DropdownMenuItem onSelect={() => setActive(!agent.isActive)}>
                {t(
                  agent.isActive
                    ? "agentEmployees.actions.deactivate"
                    : "agentEmployees.actions.activate",
                )}
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <DropdownMenuItem onSelect={() => onDelete(agent.id)}>
                {t("agentEmployees.actions.delete")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/** Search, "Agent erstellen" and the number of shown agents. */
function AgentToolbar({
  search,
  onSearch,
  canCreate,
  onCreate,
  count,
}: {
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly canCreate: boolean;
  readonly onCreate: () => void;
  readonly count: number;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <div className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-2.5">
      <div className="relative min-w-52 flex-1 sm:max-w-80">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          size="sm"
          className="pl-10 xl:pl-10"
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
          placeholder={t("agentEmployees.search")}
          aria-label={t("agentEmployees.search")}
          type="search"
        />
      </div>
      {canCreate ? (
        <Button onClick={onCreate}>
          <Plus className="size-4" aria-hidden="true" />
          {t("agentEmployees.create")}
        </Button>
      ) : null}
      <span className="text-xs tabular-nums text-muted-foreground">
        {t("agentEmployees.count", {
          count: count,
          formatted: new Intl.NumberFormat(i18n.language).format(count),
        })}
      </span>
    </div>
  );
}

/**
 * The tab "Agents" of the user administration (PAGE-266): search, "Agent
 * erstellen", the count and the table of agents; people are never listed.
 */
export function AgentDirectory({
  directory,
  agents,
}: {
  readonly directory: AdministrationPageData;
  readonly agents: AgentEmployeePageData;
}): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<{
    readonly agentId: string | null;
  } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const visible = agents.agents.filter((agent) =>
    matchesSearch(agent, search.trim().toLowerCase()),
  );
  const canDelete =
    (directory.actor.isAdmin && directory.actor.mode === "admin") ||
    (directory.actor.role?.name === "Verwaltung" && agents.canCreate);
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <AgentToolbar
        search={search}
        onSearch={setSearch}
        canCreate={agents.canCreate}
        onCreate={() => setPanel({ agentId: null })}
        count={visible.length}
      />
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-1 pt-1 pb-10"
      >
        <ManagementTable>
          <thead className="sticky top-0 z-10 bg-muted/40 text-xs font-medium text-muted-foreground">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} className="px-4 py-3 font-medium">
                  {t(`agentEmployees.columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visible.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                canManage={agents.canCreate}
                canDelete={canDelete}
                onEdit={(agentId) => setPanel({ agentId })}
                onDelete={setDeleteId}
              />
            ))}
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {t("agentEmployees.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </ManagementTable>
      </VerticalScrollArea>
      {directory.actor.isAdmin && directory.actor.mode === "admin" ? (
        <AgentDeletedList />
      ) : null}
      {deleteId ? (
        <AgentDeleteDialog
          agentId={deleteId}
          onClose={() => setDeleteId(null)}
        />
      ) : null}
      {panel ? (
        <AgentPanel
          key={panel.agentId ?? "new"}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setPanel(null);
          }}
          agentId={panel.agentId}
          models={agents.models}
          templates={agents.templates}
          voice={agents.voice}
          roles={directory.assignableRoles}
          departments={directory.departments.filter((department) =>
            directory.adoptableDepartmentIds.includes(department.id),
          )}
        />
      ) : null}
    </section>
  );
}
