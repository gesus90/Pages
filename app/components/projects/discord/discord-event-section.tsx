import { useTranslation } from "react-i18next";

import { ToggleRow } from "@/app/components/projects/integration-fields";
import { cn } from "@/app/lib/cn";
import { DISCORD_EVENT_TYPES } from "@/definition/Discord";

import type {
  DiscordEventSelection,
  DiscordEventType,
} from "@/definition/Discord";

interface DiscordEventSectionProps {
  readonly events: DiscordEventSelection;
  /** Whether the visitor may switch events; others see the selection only. */
  readonly canManage: boolean;
  readonly isBusy: boolean;
  readonly onChange: (events: DiscordEventSelection) => void;
}

/**
 * Lists the four events with a switch each.
 *
 * @remarks
 * Every switch saves on its own and sends the complete selection, so the
 * events stay independent of each other.
 */
export function DiscordEventSection({
  events,
  canManage,
  isBusy,
  onChange,
}: DiscordEventSectionProps): React.ReactElement {
  const { t } = useTranslation();

  function handleToggle(type: DiscordEventType, isOn: boolean): void {
    onChange({ ...events, [type]: isOn });
  }

  return (
    <section
      aria-labelledby="discord-events-title"
      className={cn("flex flex-col gap-4", isBusy && "opacity-70")}
    >
      <div>
        <h3
          className="text-sm font-semibold text-foreground"
          id="discord-events-title"
        >
          {t("projectDetail.discord.events.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.discord.events.hint")}
        </p>
      </div>
      {DISCORD_EVENT_TYPES.map((type) =>
        canManage ? (
          <ToggleRow
            checked={events[type]}
            hint={t(`projectDetail.discord.events.${type}.hint`)}
            isDisabled={isBusy}
            key={type}
            onChange={(isOn) => handleToggle(type, isOn)}
            title={t(`projectDetail.discord.events.${type}.title`)}
          />
        ) : (
          <p
            className="flex items-center justify-between gap-4 text-sm"
            key={type}
          >
            <span className="font-medium text-foreground">
              {t(`projectDetail.discord.events.${type}.title`)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {events[type]
                ? t("projectDetail.discord.events.on")
                : t("projectDetail.discord.events.off")}
            </span>
          </p>
        ),
      )}
    </section>
  );
}
