import { Send, Unplug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface DiscordPanelFooterProps {
  readonly isBusy: boolean;
  readonly onTest: () => void;
  readonly onDisconnect: () => void;
}

/**
 * Offers the test message and, after a second click, the disconnect.
 *
 * @remarks
 * Disconnecting removes the settings of this project only. The explanation
 * that the bot stays on the Discord server is part of the confirmation.
 */
export function DiscordPanelFooter({
  isBusy,
  onTest,
  onDisconnect,
}: DiscordPanelFooterProps): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);

  function handleAskDisconnect(): void {
    setIsConfirming(true);
  }

  function handleKeep(): void {
    setIsConfirming(false);
  }

  if (isConfirming) {
    return (
      <div className="flex w-full flex-col gap-3" role="group">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.discord.disconnect.text")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={handleKeep} variant="ghost">
            {t("projectDetail.discord.disconnect.keep")}
          </Button>
          <Button
            isPending={isBusy}
            onClick={onDisconnect}
            variant="destructive"
          >
            {t("projectDetail.discord.disconnect.confirm")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button
        className="gap-2"
        disabled={isBusy}
        onClick={handleAskDisconnect}
        variant="destructive-soft"
      >
        <Unplug className="size-4" aria-hidden="true" />
        {t("projectDetail.discord.disconnect.button")}
      </Button>
      <Button
        className="gap-2"
        isPending={isBusy}
        onClick={onTest}
        variant="outline"
      >
        <Send className="size-4" aria-hidden="true" />
        {t("projectDetail.discord.test.button")}
      </Button>
    </>
  );
}
