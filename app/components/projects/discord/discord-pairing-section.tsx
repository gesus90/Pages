import { ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DiscordQrCode } from "@/app/components/projects/discord/discord-qr-code";
import { buttonVariants } from "@/app/components/ui/button";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

interface DiscordPairingSectionProps {
  /** The official link of the running attempt; `null` once the view was reloaded. */
  readonly authorizeUrl: string | null;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onRestart: () => void;
}

/**
 * Shows how to install the bot while an attempt waits for Discord.
 *
 * @remarks
 * The QR code and the button lead to the same official authorization page.
 * The code is shown from tablet width up; on a phone the button is the way.
 * Neither connects anything: the server and the channel are confirmed in
 * Pages afterwards.
 */
export function DiscordPairingSection({
  authorizeUrl,
  isBusy,
  onCancel,
  onRestart,
}: DiscordPairingSectionProps): React.ReactElement {
  const { t } = useTranslation();

  if (authorizeUrl === null) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.discord.pairing.reloaded")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isBusy} onClick={onRestart} size="sm">
            {t("projectDetail.discord.pairing.restart")}
          </Button>
          <Button
            disabled={isBusy}
            onClick={onCancel}
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
    <section
      aria-labelledby="discord-pairing-title"
      className="flex flex-col gap-4 rounded-2xl bg-muted/40 p-4"
    >
      <h3
        className="text-sm font-semibold text-foreground"
        id="discord-pairing-title"
      >
        {t("projectDetail.discord.pairing.title")}
      </h3>
      <div className="hidden justify-center md:flex">
        <DiscordQrCode
          label={t("projectDetail.discord.pairing.qrLabel")}
          value={authorizeUrl}
        />
      </div>
      <a
        className={cn(buttonVariants({ variant: "default" }), "self-start")}
        href={authorizeUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        {t("projectDetail.discord.pairing.open")}
      </a>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("projectDetail.discord.pairing.hint")}
      </p>
      <p
        className="flex items-center gap-2 text-xs font-medium text-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {t("projectDetail.discord.pairing.waiting")}
      </p>
      <Button
        className="self-start"
        disabled={isBusy}
        onClick={onCancel}
        size="sm"
        variant="ghost"
      >
        {t("projectDetail.discord.pairing.cancel")}
      </Button>
    </section>
  );
}
