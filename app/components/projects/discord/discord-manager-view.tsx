import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DiscordChannelPicker } from "@/app/components/projects/discord/discord-channel-picker";
import { DiscordEventSection } from "@/app/components/projects/discord/discord-event-section";
import { DiscordPairingSection } from "@/app/components/projects/discord/discord-pairing-section";
import { DiscordStatusSection } from "@/app/components/projects/discord/discord-status-section";
import { Button } from "@/app/components/ui/button";
import { toEventFields } from "@/app/lib/discord-client";

import type { DiscordPanelModel } from "@/app/components/projects/discord/use-discord-panel";
import type {
  DiscordAttempt,
  DiscordConnection,
  DiscordEventSelection,
  DiscordInterfaceState,
} from "@/definition/Discord";

interface ManagerViewProps {
  readonly model: DiscordPanelModel;
  readonly state: DiscordInterfaceState;
}

function AttemptProblem({
  attempt,
}: {
  readonly attempt: DiscordAttempt;
}): React.ReactElement | null {
  const { t } = useTranslation();

  if (attempt.status === "expired") {
    return (
      <p
        className="rounded-xl bg-destructive-subtle px-4 py-2.5 text-xs font-medium text-destructive"
        role="alert"
      >
        {t("projectDetail.discord.attempt.expired")}
      </p>
    );
  }

  if (attempt.status !== "failed" || attempt.failure === null) {
    return null;
  }

  return (
    <p
      className="rounded-xl bg-destructive-subtle px-4 py-2.5 text-xs font-medium text-destructive"
      role="alert"
    >
      {t(`projectDetail.discord.attempt.${attempt.failure}`)}
    </p>
  );
}

function ChannelStep({
  attempt,
  model,
  state,
}: ManagerViewProps & {
  readonly attempt: DiscordAttempt;
}): React.ReactElement {
  const { t } = useTranslation();
  const guildName = attempt.guild?.name ?? "";

  function handleConfirm(channelId: string): void {
    void model.run("confirm", { attemptId: attempt.id, channelId });
  }

  function handleCancel(): void {
    void model.run("cancel", { attemptId: attempt.id });
  }

  function handleRetry(): void {
    void model.reload(true);
  }

  if (state.channels === null) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-2xl bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground" role="alert">
          {t(
            `projectDetail.discord.problem.${state.channelsProblem ?? "unknown"}`,
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={model.isBusy}
            onClick={handleRetry}
            size="sm"
            variant="outline"
          >
            {t("projectDetail.discord.retry")}
          </Button>
          <Button
            disabled={model.isBusy}
            onClick={handleCancel}
            size="sm"
            variant="ghost"
          >
            {t("projectDetail.discord.pairing.cancel")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <DiscordChannelPicker
      channels={state.channels}
      confirmLabel={t("projectDetail.discord.channels.confirm")}
      guildName={guildName}
      isBusy={model.isBusy}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  );
}

function ChannelChange({
  connection,
  model,
  state,
}: ManagerViewProps & {
  readonly connection: DiscordConnection;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isChanging, setIsChanging] = useState(false);

  function handleOpen(): void {
    setIsChanging(true);
    void model.reload(true);
  }

  function handleClose(): void {
    setIsChanging(false);
  }

  function handleConfirm(channelId: string): void {
    void model.run("channel", { channelId }).then(handleClose);
  }

  if (!isChanging) {
    return (
      <Button onClick={handleOpen} size="sm" variant="outline">
        {t("projectDetail.discord.channels.change")}
      </Button>
    );
  }

  return state.channels === null ? (
    <p className="text-xs text-muted-foreground" role="status">
      {state.channelsProblem
        ? t(`projectDetail.discord.problem.${state.channelsProblem}`)
        : t("projectDetail.discord.loading")}
    </p>
  ) : (
    <DiscordChannelPicker
      channels={state.channels}
      confirmLabel={t("projectDetail.discord.channels.save")}
      currentChannelId={connection.channelId}
      guildName={connection.guildName}
      isBusy={model.isBusy}
      onCancel={handleClose}
      onConfirm={handleConfirm}
    />
  );
}

function ConnectedView({
  connection,
  model,
  state,
}: ManagerViewProps & {
  readonly connection: DiscordConnection;
}): React.ReactElement {
  const { t } = useTranslation();

  function handleEvents(events: DiscordEventSelection): void {
    void model.run("events", toEventFields(events));
  }

  function handleAnotherServer(): void {
    void model.run("start");
  }

  return (
    <>
      <DiscordStatusSection connection={connection} />
      <DiscordEventSection
        canManage
        events={connection.events}
        isBusy={model.isBusy}
        onChange={handleEvents}
      />
      <ChannelChange connection={connection} model={model} state={state} />
      <Button
        disabled={model.isBusy}
        onClick={handleAnotherServer}
        size="sm"
        variant="ghost"
      >
        {t("projectDetail.discord.connect.another")}
      </Button>
    </>
  );
}

function ConnectIntro({
  model,
}: Pick<ManagerViewProps, "model">): React.ReactElement {
  const { t } = useTranslation();

  function handleConnect(): void {
    void model.run("start");
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t("projectDetail.discord.connect.title")}
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("projectDetail.discord.connect.text")}
      </p>
      <Button
        className="self-start"
        isPending={model.isBusy}
        onClick={handleConnect}
      >
        {t("projectDetail.discord.connect.button")}
      </Button>
    </section>
  );
}

/**
 * Renders what a person who may configure the interface sees.
 *
 * @remarks
 * The step follows the state the server reports: waiting for Discord,
 * confirming server and channel, the connected settings, or the start.
 */
export function DiscordManagerView({
  model,
  state,
}: ManagerViewProps): React.ReactElement {
  const attempt = state.attempt;

  function handleRestart(): void {
    void model.run("start");
  }

  function handleCancel(): void {
    if (attempt) {
      void model.run("cancel", { attemptId: attempt.id });
    }
  }

  if (attempt?.status === "pending") {
    return (
      <DiscordPairingSection
        authorizeUrl={model.authorizeUrl}
        isBusy={model.isBusy}
        onCancel={handleCancel}
        onRestart={handleRestart}
      />
    );
  }

  if (attempt?.status === "authorized") {
    return <ChannelStep attempt={attempt} model={model} state={state} />;
  }

  return (
    <>
      {attempt ? <AttemptProblem attempt={attempt} /> : null}
      {state.connection ? (
        <ConnectedView
          connection={state.connection}
          model={model}
          state={state}
        />
      ) : (
        <ConnectIntro model={model} />
      )}
    </>
  );
}
