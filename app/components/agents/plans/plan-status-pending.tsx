import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import {
  BlockNumber,
  SEQUENCE_CHEVRON,
  blockLabel,
  sequenceTone,
  showsPass,
} from "./plan-status-sequence";

import type { PlanSequencePreview } from "./plan-run-status-model";
import type { PlanSequenceBlock } from "./plan-step-sequence";

/**
 * Pending plan steps are a preview only; no run or execution evidence is synthesized.
 *
 * @remarks
 * Each agent or script execution the plan expects is a block: a loop with a
 * known count shows its members once per iteration, and an estimate is
 * hatched. Agents, scripts and loops that Start does not reach or that lie in
 * a cycle follow without a number and are marked as such.
 */
export function PlanPendingSequence({
  blocks,
  gaps,
  error,
}: {
  readonly blocks: readonly PlanSequenceBlock[];
  readonly gaps: PlanSequencePreview["gaps"];
  readonly error: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (error || (blocks.length === 0 && gaps.length === 0))
    return (
      <p className="px-3 text-xs text-muted-foreground">
        {t(error ? "plans.progress.unavailable" : "plans.progress.noRun")}
      </p>
    );
  return (
    <div
      className="flex min-w-0 gap-1 overflow-x-auto px-3"
      aria-label={t("plans.progress.sequence")}
    >
      {blocks.map((block, index) => {
        const hasPass = showsPass(block, blocks);
        const label = blockLabel(block, {
          number: index + 1,
          hasPass,
          translate: t,
        });
        return (
          <span
            key={block.key}
            title={label}
            data-sequence-kind={block.kind}
            className={cn(
              "flex h-7.5 w-11 shrink-0 items-center justify-center text-xs font-semibold tabular-nums",
              SEQUENCE_CHEVRON,
              sequenceTone(block, null),
            )}
          >
            <BlockNumber
              number={index + 1}
              pass={hasPass ? block.pass : null}
            />
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
      {gaps.map((gap) => {
        const label = `${gap.name} · ${t(`plans.progress.gap.${gap.reason}`)}`;
        return (
          <span
            key={gap.id}
            title={label}
            className={cn(
              "flex h-7.5 w-11 shrink-0 items-center justify-center bg-warning-subtle text-xs font-bold text-warning",
              SEQUENCE_CHEVRON,
            )}
          >
            <span aria-hidden="true">!</span>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </div>
  );
}
