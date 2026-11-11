import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { isAgentProfileDetail } from "./agent-profile-guards";
import { useProfileEndpoint } from "./use-profile-endpoint";

import type { AgentProfileDetail } from "@/definition/AgentProfileRead";

interface AgentProfilePanelProps {
  /** The agent to show; `null` keeps the panel closed. */
  readonly agentId: string | null;
  readonly onClose: () => void;
}

interface ProfileTextProps {
  readonly title: string;
  readonly text: string | null;
}

/** A document of the agent as plain text, or a hint when it is empty. */
function ProfileText({ title, text }: ProfileTextProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <pre className="pages-selectable max-h-48 overflow-y-auto rounded-lg bg-muted/40 p-3 text-xs break-words whitespace-pre-wrap text-foreground">
        {text ?? t("agentProfile.empty")}
      </pre>
    </section>
  );
}

/** The facts of the profile: model, access, projects and workload. */
function ProfileFacts({
  profile,
}: {
  readonly profile: AgentProfileDetail;
}): React.ReactElement {
  const { t } = useTranslation();
  const model = profile.model;
  const facts: readonly (readonly [string, string])[] = [
    [t("agentProfile.role"), profile.role ?? "—"],
    [
      t("agentProfile.model"),
      model === null
        ? "—"
        : [model.model, model.provider === null ? "" : `(${model.provider})`]
            .join(" ")
            .trim(),
    ],
    [t("agentProfile.reasoning"), model?.reasoningEffort ?? "—"],
    [t("agentProfile.access"), profile.accessLevel ?? "—"],
    [
      t("agentProfile.departments"),
      profile.departments.map((department) => department.name).join(", ") ||
        "—",
    ],
    [
      t("agentProfile.groups"),
      profile.groups.map((group) => group.name).join(", ") || "—",
    ],
    [
      t("agentProfile.projects"),
      profile.projects
        .map((project) => `${project.name} (${project.role})`)
        .join(", ") || "—",
    ],
    [t("agentProfile.activeChats"), String(profile.load.activeChats)],
    [t("agentProfile.runningSteps"), String(profile.load.runningSteps.length)],
    [
      t("agentProfile.lastActive"),
      profile.lastActiveAt === null
        ? "—"
        : new Date(profile.lastActiveAt).toLocaleString(),
    ],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="pages-selectable">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The open tickets of the agent, newest keys last. */
function ProfileTickets({
  profile,
}: {
  readonly profile: AgentProfileDetail;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">
        {t("agentProfile.openTickets", {
          count: profile.load.openTickets.length,
        })}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {profile.load.openTickets.map((ticket) => (
          <li key={ticket.id} className="pages-selectable">
            <a
              className="text-primary-text hover:text-primary-text-hover hover:underline"
              href={`/tasks/${encodeURIComponent(ticket.key)}`}
            >
              {ticket.key}
            </a>{" "}
            {ticket.title}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The read-only profile of an agent for the people who lead it (PAGE-308).
 *
 * @remarks
 * It shows what the interface of the MCP returns as `agents_read`: role,
 * `AGENT.md`, `SOUL.md`, model, workload and open tickets. It has no field
 * to change anything and never shows memory, chat contents or credentials.
 */
export function AgentProfilePanel({
  agentId,
  onClose,
}: AgentProfilePanelProps): React.ReactElement {
  const { t } = useTranslation();
  const url =
    agentId === null
      ? null
      : `/users-api/agent-profiles/${encodeURIComponent(agentId)}`;
  const {
    data: profile,
    isLoading,
    errorCode,
  } = useProfileEndpoint(url, isAgentProfileDetail);
  return (
    <Dialog open={agentId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogTitle className="text-lg font-semibold">
          {profile?.displayName ?? t("agentProfile.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-xs text-muted-foreground">
          {t("agentProfile.readOnly")}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t("agentProfile.loading")}
            </p>
          ) : null}
          {errorCode === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {t(
                errorCode === "forbidden"
                  ? "agentProfile.forbidden"
                  : "agentProfile.unavailable",
              )}
            </p>
          )}
          {profile === null ? null : (
            <>
              <ProfileFacts profile={profile} />
              <ProfileText title="AGENT.md" text={profile.agentMd} />
              <ProfileText title="SOUL.md" text={profile.soulMd} />
              <ProfileTickets profile={profile} />
            </>
          )}
        </div>
        <footer className="mt-6 flex justify-end">
          <DialogClose asChild>
            <Button variant="ghost">{t("agentProfile.close")}</Button>
          </DialogClose>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
