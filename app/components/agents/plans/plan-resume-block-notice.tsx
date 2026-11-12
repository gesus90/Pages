import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { resumeBlockText } from "./plan-run-actions";

import type {
  AgentPlanControl,
  AgentPlanResumeAction,
} from "@/definition/AgentPlanControl";

/** The actions a person can carry out at once, each with the label of its button. */
const BUTTON_LABELS: Readonly<Partial<Record<AgentPlanResumeAction, string>>> =
  {
    admin_mode: "plans.resumeBlock.button.admin_mode",
    release: "plans.resumeBlock.button.release",
    restart: "plans.resumeBlock.button.restart",
  };

/**
 * Says why Fortsetzen is off and offers the action that lifts the block.
 *
 * @remarks
 * The reason is visible text, not a tooltip, so touch screens read it too.
 * Without a block, nothing is shown; a block always names its reason.
 */
export function PlanResumeBlockNotice({
  control,
  isPending,
  onResolve,
}: {
  readonly control: AgentPlanControl | undefined;
  readonly isPending: boolean;
  readonly onResolve: (action: AgentPlanResumeAction) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const block = control?.resumeBlock;
  if (!control || !block || control.canResume) return null;
  const label = BUTTON_LABELS[block.action];
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-2"
    >
      <p className="min-w-0 flex-1 basis-60 text-xs wrap-anywhere text-warning">
        {resumeBlockText(block, t)}
        {block.holderRunId
          ? ` ${t("plans.resumeBlock.holder", { run: block.holderRunId.slice(0, 8) })}`
          : ""}
      </p>
      {label ? (
        <Button
          size="xs"
          variant="outline"
          disabled={isPending}
          className="[@media(pointer:coarse)]:h-11"
          onClick={() => onResolve(block.action)}
        >
          {t(label)}
        </Button>
      ) : null}
    </div>
  );
}
