import { ArrowRight, BookOpen, Plug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { GitHubPanel } from "@/app/components/projects/github-integration-panel";
import {
  IntegrationCard,
  PlannedIntegrationCard,
} from "@/app/components/projects/integration-card";

import type { IntegrationId } from "@/app/components/projects/integration-service-icon";
import type { ProjectIntegration } from "@/definition/Project";

/** The interfaces in display order; only GitHub is available today. */
const PLANNED_INTEGRATIONS: readonly {
  readonly id: IntegrationId;
  readonly nameKey: string;
  readonly descriptionKey: string;
}[] = [
  {
    descriptionKey: "projectDetail.interfaces.calendarDescription",
    id: "google-calendar",
    nameKey: "projectDetail.interfaces.calendarName",
  },
  {
    descriptionKey: "projectDetail.interfaces.discordDescription",
    id: "discord",
    nameKey: "projectDetail.interfaces.discordName",
  },
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
  readonly canWrite: boolean;
  readonly projectId: string;
}

/**
 * Renders the project interfaces tab with the GitHub card and the planned ones.
 *
 * @remarks
 * Selecting the GitHub card opens its settings as a fixed overlay on the
 * right, leaving the main page width and position untouched. The other
 * interfaces are announced as planned and cannot be opened.
 */
export function ProjectIntegrationsTab({
  integration,
  canWrite,
  projectId,
}: ProjectIntegrationsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [isGitHubOpen, setIsGitHubOpen] = useState(false);

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
            onSelect={() => setIsGitHubOpen(true)}
            selected={isGitHubOpen}
          />
          {PLANNED_INTEGRATIONS.map((planned) => (
            <PlannedIntegrationCard
              description={t(planned.descriptionKey)}
              id={planned.id}
              key={planned.id}
              name={t(planned.nameKey)}
            />
          ))}
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

      {isGitHubOpen ? (
        <GitHubPanel
          key={integration?.updatedAt ?? "github-new"}
          canWrite={canWrite}
          integration={integration}
          onClose={() => setIsGitHubOpen(false)}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}
