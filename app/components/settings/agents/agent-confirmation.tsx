import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  AGENT_PROVIDERS,
  MODEL_TEST_PROMPT,
} from "@/definition/AgentConnection";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";

export interface AgentConfirmationRequest {
  readonly connection: AgentConnectionSummary;
  readonly command: "model" | "delete" | "logout";
}

/** Confirms costs or credential removal before the corresponding POST. */
export function AgentConfirmation({
  request,
  onClose,
  onConfirm,
}: {
  readonly request: AgentConfirmationRequest;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { connection, command } = request;
  const deleteDescription = connection.cli
    ? "deleteCliDescription"
    : "deleteApiDescription";
  const descriptionKey =
    command === "delete" ? deleteDescription : `${command}Description`;
  const model = connection.testModel ?? t("settings.agents.cliDefault");
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="sm">
        <DialogTitle className="text-base font-semibold">
          {t(`settings.agents.confirm.${command}Title`)}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t(`settings.agents.confirm.${descriptionKey}`, {
            name: connection.name,
            tool: t(AGENT_PROVIDERS[connection.provider].labelKey),
            model: connection.reasoningEffort
              ? t("settings.agents.confirm.modelWithEffort", {
                  model,
                  effort: connection.reasoningEffort,
                })
              : model,
            prompt: MODEL_TEST_PROMPT,
          })}
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t("settings.agents.cancel")}</Button>
          </DialogClose>
          <Button
            variant={command === "model" ? "default" : "destructive"}
            onClick={onConfirm}
          >
            {t(`settings.agents.confirm.${command}Action`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
