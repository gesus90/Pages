import { Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { PlanSequenceBlockKind } from "./plan-step-sequence";

interface StatusOutlookProps {
  readonly name: string;
  readonly number: number;
  readonly pass: number | null;
  readonly kind: Exclude<PlanSequenceBlockKind, "actual">;
  readonly canLocate: boolean;
  readonly onLocate: () => void;
}

/**
 * The details of a block that has no record yet: a planned or assumed execution.
 *
 * @remarks
 * It names the node and its pass and says that nothing has started; it shows
 * no status, output or session, because the run has none for this block.
 */
export function PlanStatusOutlook({
  name,
  number,
  pass,
  kind,
  canLocate,
  onLocate,
}: StatusOutlookProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("plans.progress.step", { number })}
      className="flex flex-col gap-1 border-t border-border px-4 py-3 text-xs leading-4.5"
    >
      <h3 className="text-sm leading-5 font-semibold wrap-anywhere">
        {t("plans.progress.step", { number })} · {name}
        {pass ? ` · ${t("plans.progress.pass", { pass })}` : null}
      </h3>
      <p className="text-muted-foreground wrap-anywhere">
        {t(`plans.progress.outlook.${kind}`)}
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1 h-auto min-h-8 max-w-full justify-start self-start rounded-md px-0 text-xs leading-4.5 text-muted-foreground whitespace-normal xl:min-h-8 xl:px-0 xl:text-xs [@media(pointer:coarse)]:min-h-11"
        onClick={onLocate}
        disabled={!canLocate}
      >
        <Crosshair aria-hidden="true" className="size-4 shrink-0" />
        {t(canLocate ? "plans.progress.locate" : "plans.progress.nodeMissing")}
      </Button>
    </section>
  );
}
