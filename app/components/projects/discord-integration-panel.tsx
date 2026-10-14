import { useTranslation } from "react-i18next";

import { DiscordEventSection } from "@/app/components/projects/discord/discord-event-section";
import { DiscordInstanceNotice } from "@/app/components/projects/discord/discord-instance-notice";
import { DiscordManagerView } from "@/app/components/projects/discord/discord-manager-view";
import { DiscordPanelFooter } from "@/app/components/projects/discord/discord-panel-footer";
import { DiscordStatusSection } from "@/app/components/projects/discord/discord-status-section";
import { useDiscordPanel } from "@/app/components/projects/discord/use-discord-panel";
import { ServiceIdentity } from "@/app/components/projects/integration-fields";
import { PanelShell } from "@/app/components/projects/integration-panel-shell";
import { Button } from "@/app/components/ui/button";

import type { DiscordPanelModel } from "@/app/components/projects/discord/use-discord-panel";
import type { DiscordInterfaceState } from "@/definition/Discord";

interface DiscordPanelProps {
  readonly projectId: string;
  readonly onClose: () => void;
  /** Told whenever the panel learns whether the project is connected. */
  readonly onConnectionChange: (isConnected: boolean) => void;
}

function ReadOnlyView({
  state,
}: {
  readonly state: DiscordInterfaceState;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {state.connection ? (
        <>
          <DiscordStatusSection connection={state.connection} />
          <DiscordEventSection
            canManage={false}
            events={state.connection.events}
            isBusy={false}
            onChange={() => undefined}
          />
        </>
      ) : null}
      <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {t("projectDetail.interfaces.readOnlyHint")}
      </p>
    </>
  );
}

interface NoticeContent {
  readonly isError: boolean;
  readonly text: string;
}

/** Picks the outcome of the last request that is worth showing below the content. */
function findNotice(
  model: DiscordPanelModel,
  translate: (key: string, options?: Record<string, string>) => string,
): NoticeContent | null {
  if (model.failure !== null) {
    return {
      isError: true,
      text: translate(`projectDetail.discord.error.${model.failure}`),
    };
  }

  if (model.testResult === null) {
    return null;
  }

  if (model.testResult.isSent) {
    return {
      isError: false,
      text: translate("projectDetail.discord.test.sent"),
    };
  }

  return {
    isError: true,
    text: translate("projectDetail.discord.test.failed", {
      reason: translate(
        `projectDetail.discord.problem.${model.testResult.problem ?? "unknown"}`,
      ),
    }),
  };
}

function PanelNotice({
  notice,
}: {
  readonly notice: NoticeContent;
}): React.ReactElement {
  return (
    <p
      className={
        notice.isError
          ? "rounded-xl bg-destructive-subtle px-4 py-2.5 text-xs font-medium text-destructive"
          : "rounded-xl bg-success-subtle px-4 py-2.5 text-xs font-medium text-success"
      }
      role={notice.isError ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

function PanelBody({
  model,
}: {
  readonly model: DiscordPanelModel;
}): React.ReactElement {
  const { t } = useTranslation();
  const state = model.state;

  function handleRetry(): void {
    void model.reload();
  }

  if (state === null) {
    return model.isLoading ? (
      <p className="text-xs text-muted-foreground" role="status">
        {t("projectDetail.discord.loading")}
      </p>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <p className="text-xs text-destructive" role="alert">
          {t("projectDetail.discord.loadFailed")}
        </p>
        <Button onClick={handleRetry} size="sm" variant="outline">
          {t("projectDetail.discord.retry")}
        </Button>
      </div>
    );
  }

  if (!state.instance.isConfigured) {
    return (
      <DiscordInstanceNotice
        canManage={state.canManage}
        instance={state.instance}
      />
    );
  }

  return state.canManage ? (
    <DiscordManagerView model={model} state={state} />
  ) : (
    <ReadOnlyView state={state} />
  );
}

/**
 * Renders the Discord settings panel of a project.
 *
 * @remarks
 * Everyone who can read the project sees the connection; only people who may
 * write in the project can connect, choose the channel, switch events, send
 * a test message and disconnect. No Discord credential is asked for or shown:
 * the application belongs to the instance and is set up by an administrator.
 */
export function DiscordPanel({
  projectId,
  onClose,
  onConnectionChange,
}: DiscordPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const model = useDiscordPanel(projectId, onConnectionChange);
  const state = model.state;
  const notice = findNotice(model, (key, options) => t(key, options));
  const isConnected = state !== null && state.connection !== null;
  const canShowFooter =
    state !== null &&
    state.canManage &&
    state.instance.isConfigured &&
    isConnected &&
    state.attempt?.status !== "pending" &&
    state.attempt?.status !== "authorized";

  function handleTest(): void {
    void model.run("test");
  }

  function handleDisconnect(): void {
    void model.run("disconnect");
  }

  return (
    <PanelShell
      footer={
        canShowFooter ? (
          <DiscordPanelFooter
            isBusy={model.isBusy}
            onDisconnect={handleDisconnect}
            onTest={handleTest}
          />
        ) : null
      }
      notice={notice ? <PanelNotice notice={notice} /> : null}
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.discordName")}
    >
      <ServiceIdentity
        connected={isConnected}
        description={t("projectDetail.interfaces.discordDescription")}
        id="discord"
        name={t("projectDetail.interfaces.discordName")}
      />
      <PanelBody model={model} />
    </PanelShell>
  );
}
