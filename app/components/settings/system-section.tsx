import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSectionHeader } from "@/app/components/settings/settings-layout";
import { AcpResourcesCard } from "@/app/components/settings/agents/acp-resources-card";
import { ChatSettingsCard } from "@/app/components/settings/system/chat-settings-card";
import { GoogleDriveCard } from "@/app/components/settings/system/google-drive-card";
import { InterpreterCard } from "@/app/components/settings/system/interpreter-card";
import { InstanceCard } from "@/app/components/settings/system/instance-card";
import { ServerCard } from "@/app/components/settings/system/server-card";
import { LoggingCard } from "@/app/components/settings/system/logging-card";
import { SystemDashboardCard } from "@/app/components/settings/system/system-dashboard-card";
import { WikiSettingsCard } from "@/app/components/settings/system/wiki-settings-card";

import { TicketAssetsCard } from "./system/ticket-assets-card";

import type { ChatAdministration } from "@/definition/Chat";
import type { InstanceBranding } from "@/definition/Instance";
import type { WikiSettings } from "@/definition/Wiki";
import type { LoggingStatus } from "@/definition/Logging";

interface SystemSectionProps {
  readonly logging: {
    readonly retentionDays: number;
    readonly status: LoggingStatus;
  };
  /** Port stored in the configuration for the next start. */
  readonly port: number;
  readonly branding: InstanceBranding;
  /** Retention times and upload limits of the wiki. */
  readonly wikiSettings: WikiSettings;
  /** Supplementary instruction of the chat agent. */
  readonly chatSettings: ChatAdministration;
}

/**
 * Renders the system settings that administrators see.
 *
 * @remarks
 * The system dashboard stands above both columns (PAGE-282). Company name
 * and logo are stored in the database and apply at once. The port is stored
 * in the configuration file and applies after Pages restarts.
 */
export function SystemSection({
  port,
  branding,
  wikiSettings,
  chatSettings,
  logging,
}: SystemSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section>
      <SettingsSectionHeader
        description={t("settings.system.description")}
        icon={<Server className="size-4" aria-hidden="true" />}
        title={t("settings.system.title")}
      />
      <SystemDashboardCard />
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <GoogleDriveCard />
          <InterpreterCard />
          <InstanceCard branding={branding} />
          <WikiSettingsCard settings={wikiSettings} />
          <TicketAssetsCard />
          <AcpResourcesCard canConfigure />
        </div>
        <div className="flex flex-col gap-4">
          <ServerCard port={port} />
          <LoggingCard
            retentionDays={logging.retentionDays}
            status={logging.status}
          />
          <ChatSettingsCard settings={chatSettings} />
        </div>
      </div>
    </section>
  );
}
