import { CheckCircle2, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { Route } from "./+types/discord-result";

const OUTCOMES = [
  "authorized",
  "denied",
  "invalid",
  "used",
  "expired",
  "failed",
  "not_configured",
] as const;

type DiscordResultOutcome = (typeof OUTCOMES)[number];

function readOutcome(value: string | null): DiscordResultOutcome {
  return OUTCOMES.find((outcome) => outcome === value) ?? "invalid";
}

/** Keeps the page out of caches and the address out of referrers. */
export function headers(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
}

/** Reads the outcome of the Discord callback from the address. */
export function loader({ request }: Route.LoaderArgs): {
  readonly outcome: DiscordResultOutcome;
} {
  return {
    outcome: readOutcome(new URL(request.url).searchParams.get("outcome")),
  };
}

/**
 * Tells whoever returned from Discord what happened and what to do next.
 *
 * @remarks
 * The page needs no session and shows no project data. It is what the phone
 * displays after the QR code scan; the confirmation happens in Pages on the
 * computer that started the connection.
 */
export default function DiscordResultRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { outcome } = useLoaderData<typeof loader>();
  const isAuthorized = outcome === "authorized";
  const Icon = isAuthorized ? CheckCircle2 : CircleAlert;

  return (
    <AuthLayout>
      <AuthHeading
        subtitle={t(`discordResult.${outcome}.text`)}
        title={t(`discordResult.${outcome}.title`)}
      />
      <p
        className="pages-selectable mt-6 flex items-start gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm leading-relaxed text-foreground"
        role="status"
      >
        <Icon
          aria-hidden="true"
          className={
            isAuthorized
              ? "mt-0.5 size-5 shrink-0 text-success"
              : "mt-0.5 size-5 shrink-0 text-destructive"
          }
        />
        {t(isAuthorized ? "discordResult.nextStep" : "discordResult.tryAgain")}
      </p>
      <a
        className={cn(buttonVariants({ variant: "outline" }), "mt-6 w-full")}
        href="/"
      >
        {t("discordResult.backToPages")}
      </a>
    </AuthLayout>
  );
}
