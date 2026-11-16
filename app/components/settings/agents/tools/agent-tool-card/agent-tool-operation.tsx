import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentToolView } from "@/definition/AgentTools";

/**
 * Shows the running or last operation with its phase, and the action that repeats a failed one.
 * @remarks
 * Rendered inside the card's form, so the retry button submits the same
 * fixed action the server serializes per tool.
 */
export function AgentToolOperation({
  tool,
  isPending,
}: {
  readonly tool: AgentToolView;
  readonly isPending: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { operation } = tool;
  if (!operation) return null;
  const values = {
    action: t(`agentTools.actions.${operation.action}`),
    phase: t(`agentTools.operation.phase.${operation.phase}`),
  };
  if (operation.state !== "failed")
    return (
      <p className="text-sm text-muted-foreground">
        {t(`agentTools.operation.${operation.state}`, values)}
      </p>
    );
  return (
    <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>{t("agentTools.operation.failed", values)}</p>
      {operation.diagnostic ? (
        <p>{t(`agentTools.diagnostic.${operation.diagnostic}`)}</p>
      ) : null}
      {operation.retryAction ? (
        <Button
          type="submit"
          name="intent"
          value={operation.retryAction}
          size="sm"
          variant="outline"
          disabled={isPending}
        >
          {t("agentTools.operation.retry", {
            action: t(`agentTools.actions.${operation.retryAction}`),
          })}
        </Button>
      ) : null}
    </div>
  );
}
