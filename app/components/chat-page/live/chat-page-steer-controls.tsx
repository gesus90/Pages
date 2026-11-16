import { ChevronDown, CornerDownLeft, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

interface ChatPageSteerControlsProps {
  /** Who answers now, for the labels. */
  readonly name: string;
  readonly canSend: boolean;
  /** Puts the message into the running answer (Enter). */
  readonly onSteer: () => void;
  /** Sends the message after the running answer (⌥↵). */
  readonly onAfter: () => void;
  /** Stops the running answer (Esc). */
  readonly onStop: () => void;
}

/**
 * The foot of the input while an agent answers: a round stop button and the
 * main button "Umlenken ↵", whose arrow opens "Umlenken", "Danach senden" and
 * "Anhalten"; the hint "Enter lenkt um · ⇧Enter neue Zeile" is read out only.
 */
export function ChatPageSteerControls({
  name,
  canSend,
  onSteer,
  onAfter,
  onStop,
}: ChatPageSteerControlsProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <span className="sr-only">{t("chatPage.liveAnswer.steerHint")}</span>
      <Button
        aria-label={t("chatPage.liveAnswer.halt")}
        className="size-11 shrink-0 rounded-full p-0 xl:size-9"
        onClick={onStop}
        title={`${t("chatPage.liveAnswer.halt")} (${t("chatPage.liveAnswer.haltShortcut")})`}
        type="button"
        variant="outline"
      >
        <Square aria-hidden="true" className="size-3.5 fill-current" />
      </Button>
      <div className="flex shrink-0 items-stretch">
        <Button
          aria-label={t("chatPage.liveAnswer.steerLabel", { name })}
          className="h-11 gap-1.5 rounded-r-none px-3 text-sm xl:h-9"
          disabled={!canSend}
          onClick={onSteer}
          type="button"
        >
          {t("chatPage.liveAnswer.steer")}
          <CornerDownLeft aria-hidden="true" className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("chatPage.liveAnswer.more")}
              className="h-11 rounded-l-none border-l border-primary-foreground/30 px-2 xl:h-9"
              type="button"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!canSend} onSelect={onSteer}>
              {t("chatPage.liveAnswer.steer")}
              <DropdownMenuShortcut>
                {t("chatPage.liveAnswer.steerShortcut")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canSend} onSelect={onAfter}>
              {t("chatPage.liveAnswer.after")}
              <DropdownMenuShortcut>
                {t("chatPage.liveAnswer.afterShortcut")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onStop}>
              {t("chatPage.liveAnswer.halt")}
              <DropdownMenuShortcut>
                {t("chatPage.liveAnswer.haltShortcut")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
