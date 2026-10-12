import { CheckCircle2, CircleX, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRevalidator } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { buttonVariants } from "@/app/components/ui/button";

import type { McpPairingView } from "@/definition/McpPairing";

/** Announces the lifecycle and polls only while an approved request awaits its device. */
export function PairingState({
  view,
}: {
  readonly view: McpPairingView;
}): React.ReactElement {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const actionRef = useRef<HTMLAnchorElement>(null);
  const waiting = view.status === "approved";
  const completed = waiting || view.status === "consumed";
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, revalidator]);
  useEffect(() => {
    if (completed || view.status === "denied") actionRef.current?.focus();
  }, [completed, view.status]);
  const state = completed ? "approved" : view.status;
  const title =
    state === "entry" ? t("mcpPairing.title") : t(`mcpPairing.${state}.title`);
  const description =
    state === "entry"
      ? t("mcpPairing.enter.description")
      : t(`mcpPairing.${state}.description`);
  return (
    <>
      <AuthHeading title={title} subtitle={description} />
      {view.status !== "entry" ? (
        <div role="status" className="mt-6 flex items-center gap-2 text-sm">
          {completed ? (
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
          ) : (
            <CircleX className="size-5" aria-hidden="true" />
          )}
          {waiting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t("mcpPairing.approved.waiting")}
            </>
          ) : null}
          {view.status === "consumed" ? t("mcpPairing.approved.claimed") : null}
        </div>
      ) : null}
      {completed || view.status === "denied" ? (
        <Link
          className={`${buttonVariants({ variant: "outline" })} mt-6 w-full`}
          ref={actionRef}
          to={completed ? "/settings/connections" : "/dashboard"}
        >
          {t(
            completed
              ? "mcpPairing.approved.open"
              : "mcpPairing.denied.dashboard",
          )}
        </Link>
      ) : null}
    </>
  );
}
