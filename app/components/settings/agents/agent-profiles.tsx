import { Bot, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { Link } from "react-router";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { EMPTY_AGENT_FILTERS } from "@/definition/AgentFilters";

import { AgentProfileForm } from "./agent-profile-form";
import { AgentProfileRow } from "./agent-profile-row";
import { AgentListFilters } from "./agent-list-filters";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentAvailability } from "@/definition/AgentAvailability";
import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";

/** The central panel manages the same agent IDs used for functions and future plan steps. */
export function AgentProfiles(props: {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly profiles: readonly AgentProfile[];
  readonly connections: readonly AgentConnectionSummary[];
  readonly catalogs: Readonly<Record<string, AgentModelCatalog>>;
  readonly directory: AgentProfileDirectory;
  readonly availability?: Readonly<Record<string, AgentAvailability>>;
  readonly filters?: AgentFilters;
  readonly projects?: readonly { readonly id: string; readonly name: string }[];
  readonly taskAssignments?: Readonly<
    Record<string, readonly AgentTaskAssignment[]>
  >;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<AgentProfile | "new" | null>(null);
  const filters = props.filters ?? EMPTY_AGENT_FILTERS;
  const hasFilters = Object.values(filters).some(Boolean);
  function close(): void {
    setSelected(null);
  }
  return (
    <SettingsCard
      icon={<Bot className="size-4" aria-hidden="true" />}
      wrapHeader
      title={t("settings.agents.profiles.title")}
      description={t("settings.agents.profiles.description")}
      action={
        <Button size="sm" variant="outline" onClick={() => setSelected("new")}>
          <Plus className="size-4" aria-hidden="true" />
          {t("settings.agents.profiles.add")}
        </Button>
      }
    >
      <AgentListFilters
        key={JSON.stringify(filters)}
        filters={filters}
        connections={props.connections}
      />
      {props.profiles.length === 0 ? (
        <div className="space-y-3 py-6 text-center text-sm text-muted-foreground">
          <p>
            {t(
              hasFilters
                ? "settings.agents.definition.emptyFiltered"
                : "settings.agents.profiles.empty",
            )}
          </p>
          {hasFilters ? (
            <Link
              to="/settings/agents"
              className={buttonVariants({ variant: "link" })}
            >
              {t("settings.agents.definition.resetFilters")}
            </Link>
          ) : null}
        </div>
      ) : (
        <HorizontalScrollArea className="mt-4">
          <table className="w-full text-left text-sm">
            <AgentProfileTableHead />
            <tbody className="divide-y divide-border/60">
              {props.profiles.map((profile) => (
                <AgentProfileRow
                  key={profile.id}
                  profile={profile}
                  connections={props.connections}
                  directory={props.directory}
                  availability={props.availability?.[profile.id]}
                  onEdit={() => setSelected(profile)}
                />
              ))}
            </tbody>
          </table>
        </HorizontalScrollArea>
      )}
      <Dialog open={selected !== null} onOpenChange={close}>
        {selected ? (
          <AgentProfileForm
            profile={selected === "new" ? null : selected}
            taskAssignments={
              selected === "new"
                ? undefined
                : (props.taskAssignments?.[selected.id] ?? [])
            }
            workspaceChoices={props.workspaceChoices}
            connections={props.connections}
            catalogs={props.catalogs}
            directory={props.directory}
            projects={props.projects}
            onSaved={close}
          />
        ) : null}
      </Dialog>
    </SettingsCard>
  );
}

function AgentProfileTableHead(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <thead className="bg-muted/40 text-xs font-medium text-muted-foreground">
      <tr>
        {[
          "name",
          "scope",
          "connection",
          "model",
          "purposes",
          "status",
          "usability",
          "actions",
        ].map((column) => (
          <th key={column} scope="col" className="px-4 py-3">
            {t(`settings.agents.profiles.${column}`)}
          </th>
        ))}
      </tr>
    </thead>
  );
}
