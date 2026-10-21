import { Hash, Megaphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { DiscordChannelChoice } from "@/definition/Discord";

interface DiscordChannelPickerProps {
  readonly guildName: string;
  readonly channels: readonly DiscordChannelChoice[];
  /** Channel that is connected right now; it starts out selected. */
  readonly currentChannelId?: string;
  readonly confirmLabel: string;
  readonly isBusy: boolean;
  readonly onConfirm: (channelId: string) => void;
  readonly onCancel?: () => void;
}

interface ChannelOptionProps {
  readonly channel: DiscordChannelChoice;
  readonly isChecked: boolean;
  readonly onSelect: (channelId: string) => void;
}

function ChannelOption({
  channel,
  isChecked,
  onSelect,
}: ChannelOptionProps): React.ReactElement {
  const { t } = useTranslation();
  const Icon = channel.kind === "announcement" ? Megaphone : Hash;
  const reasonId = `discord-channel-${channel.id}-reason`;

  function handleChange(): void {
    onSelect(channel.id);
  }

  return (
    <li>
      <label
        className={cn(
          "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm",
          channel.isSelectable
            ? "cursor-pointer border-border bg-surface hover:border-primary/50"
            : "cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground",
          isChecked && "border-primary bg-primary-subtle",
        )}
      >
        <input
          aria-describedby={channel.isSelectable ? undefined : reasonId}
          checked={isChecked}
          className="mt-1 accent-primary"
          disabled={!channel.isSelectable}
          name="discord-channel"
          onChange={handleChange}
          type="radio"
          value={channel.id}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-medium">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{channel.name}</span>
            <span className="sr-only">
              {t(`projectDetail.discord.channels.kind.${channel.kind}`)}
            </span>
          </span>
          {channel.isSelectable ? null : (
            <span className="text-xs" id={reasonId}>
              {channel.missing
                .map((permission) =>
                  t(`projectDetail.discord.channels.missing.${permission}`),
                )
                .join(" ")}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

/**
 * Lets a person choose the channel that receives the notifications.
 *
 * @remarks
 * Every text and announcement channel of the server is listed. A channel in
 * which the bot cannot see or send stays visible but disabled, with the reason
 * next to it, so nobody wonders why a channel is missing.
 */
export function DiscordChannelPicker({
  guildName,
  channels,
  currentChannelId,
  confirmLabel,
  isBusy,
  onConfirm,
  onCancel,
}: DiscordChannelPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(
    channels.find((channel) => channel.id === currentChannelId)?.id ?? null,
  );

  function handleConfirm(): void {
    if (selectedId !== null) {
      onConfirm(selectedId);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-foreground">
        {t("projectDetail.discord.channels.title")}
      </legend>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("projectDetail.discord.channels.server", { name: guildName })}
      </p>
      {channels.length === 0 ? (
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
          {t("projectDetail.discord.channels.none")}
        </p>
      ) : (
        <ScrollViewport
          as="ul"
          axis="vertical"
          containerClassName="max-h-72"
          className="flex flex-col gap-2 overflow-y-auto pr-1"
        >
          {channels.map((channel) => (
            <ChannelOption
              channel={channel}
              isChecked={channel.id === selectedId}
              key={channel.id}
              onSelect={setSelectedId}
            />
          ))}
        </ScrollViewport>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={selectedId === null || selectedId === currentChannelId}
          isPending={isBusy}
          onClick={handleConfirm}
          size="sm"
        >
          {confirmLabel}
        </Button>
        {onCancel ? (
          <Button
            disabled={isBusy}
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            {t("projectDetail.discord.channels.cancel")}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
