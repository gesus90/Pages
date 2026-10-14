import { ArrowRight, BookOpen, Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DiscordPanel } from "@/app/components/projects/discord-integration-panel";
import { GitHubPanel } from "@/app/components/projects/github-integration-panel";
import { useGitHubSubmission } from "@/app/components/projects/github/use-github-submission";
import {
  IntegrationCard,
  PlannedIntegrationCard,
} from "@/app/components/projects/integration-card";

import type { IntegrationId } from "@/app/components/projects/integration-service-icon";
import type { ProjectIntegration } from "@/definition/Project";

interface PlannedIntegration {
  readonly id: IntegrationId;
  readonly nameKey: string;
  readonly descriptionKey: string;
}

/** The planned interfaces that are listed between GitHub and Discord. */
const PLANNED_BEFORE_DISCORD: readonly PlannedIntegration[] = [
  {
    descriptionKey: "projectDetail.interfaces.calendarDescription",
    id: "google-calendar",
    nameKey: "projectDetail.interfaces.calendarName",
  },
];

/** The planned interfaces that are listed after Discord. */
const PLANNED_AFTER_DISCORD: readonly PlannedIntegration[] = [
  {
    descriptionKey: "projectDetail.interfaces.webhooksDescription",
    id: "webhooks",
    nameKey: "projectDetail.interfaces.webhooksName",
  },
  {
    descriptionKey: "projectDetail.interfaces.emailDescription",
    id: "email",
    nameKey: "projectDetail.interfaces.emailName",
  },
  {
    descriptionKey: "projectDetail.interfaces.restApiDescription",
    id: "rest-api",
    nameKey: "projectDetail.interfaces.restApiName",
  },
];

interface ProjectIntegrationsTabProps {
  readonly integration: ProjectIntegration | null;
  /** Whether the project has a Discord connection when the tab loads. */
  readonly isDiscordConnected: boolean;
  readonly canWrite: boolean;
  readonly projectId: string;
}

function renderPlanned(
  planned: PlannedIntegration,
  translate: (key: string) => string,
): React.ReactElement {
  return (
    <PlannedIntegrationCard
      description={translate(planned.descriptionKey)}
      id={planned.id}
      key={planned.id}
      name={translate(planned.nameKey)}
    />
  );
}

/**
 * Renders the project interfaces tab with the GitHub and Discord cards and the planned ones.
 *
 * @remarks
 * Selecting a card opens its settings as a fixed overlay on the right,
 * leaving the main page width and position untouched; one panel is open at a
 * time. The other interfaces are announced as planned and cannot be opened.
 */
export function ProjectIntegrationsTab({
  integration,
  isDiscordConnected,
  canWrite,
  projectId,
}: ProjectIntegrationsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [openPanel, setOpenPanel] = useState<"github" | "discord" | null>(null);
  const [isDiscordLinked, setIsDiscordLinked] = useState(isDiscordConnected);
  const submission = useGitHubSubmission();

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-muted/40 p-6">
        <h2 className="flex select-none items-center gap-2.5 font-semibold text-foreground">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-surface text-primary shadow-xs"
          >
            <Plug className="size-4" />
          </span>
          {t("projectDetail.interfaces.availableTitle")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.availableSubtitle")}
        </p>

        <div className="mt-5 grid items-start gap-4 md:grid-cols-2">
          <IntegrationCard
            connected={integration?.isConnected ?? false}
            description={t("projectDetail.interfaces.githubCardDescription")}
            id="github"
            name={t("projectDetail.interfaces.githubName")}
            onSelect={() => setOpenPanel("github")}
            selected={openPanel === "github"}
          />
          {PLANNED_BEFORE_DISCORD.map((planned) => renderPlanned(planned, t))}
          <IntegrationCard
            connected={isDiscordLinked}
            description={t("projectDetail.interfaces.discordCardDescription")}
            id="discord"
            name={t("projectDetail.interfaces.discordName")}
            onSelect={() => setOpenPanel("discord")}
            selected={openPanel === "discord"}
          />
          {PLANNED_AFTER_DISCORD.map((planned) => renderPlanned(planned, t))}
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-primary-subtle px-5 py-4">
          <BookOpen
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("projectDetail.interfaces.aboutTitle")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("projectDetail.interfaces.aboutText")}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
              {t("projectDetail.interfaces.learnMore")}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </p>
          </div>
        </div>
      </section>

      {openPanel === "github" ? (
        <GitHubPanel
          key={integration?.updatedAt ?? "github-new"}
          canWrite={canWrite}
          integration={integration}
          onClose={() => setOpenPanel(null)}
          projectId={projectId}
          submission={submission}
        />
      ) : null}
      {openPanel === "discord" ? (
        <DiscordPanel
          key={projectId}
          onClose={() => setOpenPanel(null)}
          onConnectionChange={setIsDiscordLinked}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}
