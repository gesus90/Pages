import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { McpPairingState } from "@/definition/McpDevice";

interface McpPairingOutcomeProps {
  /** Any state but `open`. */
  readonly state: Exclude<McpPairingState, "open">;
  /** The machine the sentence names; only a paired machine is named. */
  readonly deviceName: string | null;
}

/** Renders the result of a code: paired with its way on, or one sentence about why not. */
export function McpPairingOutcome({
  state,
  deviceName,
}: McpPairingOutcomeProps): React.ReactElement {
  const { t } = useTranslation();

  if (state === "missing") {
    return (
      <p className="pages-selectable text-center text-base leading-relaxed text-foreground">
        {t("mcpPairing.missing")}
      </p>
    );
  }

  const isPaired = state === "paired";

  return (
    <div className="flex flex-col items-center text-center">
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full",
          isPaired
            ? "bg-success-subtle text-success"
            : "bg-destructive-subtle text-destructive",
        )}
        aria-hidden="true"
      >
        {isPaired ? <Check className="size-7" /> : <X className="size-7" />}
      </span>
      {isPaired ? (
        <>
          <h1 className="mt-6 text-2xl leading-tight font-bold tracking-tight text-foreground sm:text-3xl">
            {t("mcpPairing.paired.title")}
          </h1>
          <p className="pages-selectable mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("mcpPairing.paired.text", { device: deviceName ?? "" })}
          </p>
          <Link
            className={cn(buttonVariants({ variant: "outline" }), "mt-8")}
            to="/settings/connections"
          >
            {t("mcpPairing.paired.show")}
          </Link>
        </>
      ) : (
        <p className="pages-selectable mt-6 text-base leading-relaxed text-foreground">
          {t(`mcpPairing.${state}`)}
        </p>
      )}
    </div>
  );
}
