import { ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";

import type { OpenedConversation } from "./use-chat-page";

/** Whether the opened chat is marked confidential, and the change of it (PAGE-305). */
export interface ConfidentialControl {
  /** `null` for a chat without agents, as with a person. */
  readonly isConfidential: boolean | null;
  readonly onToggle: () => void;
}

/** The field and the stored state of the opened chat; `null` for a chat with a person. */
function confidentialTarget(opened: OpenedConversation | null): {
  readonly field: "agentId" | "conversationId";
  readonly id: string;
  readonly isConfidential: boolean;
} | null {
  if (!opened) return null;
  if (opened.kind === "group")
    return {
      field: "conversationId",
      id: opened.group.id,
      isConfidential: opened.group.isConfidential === true,
    };
  const { participant } = opened;
  return participant.kind === "agent"
    ? {
        field: "agentId",
        id: participant.id,
        isConfidential: participant.isConfidential === true,
      }
    : null;
}

/**
 * Marks the opened chat with an agent, or the opened group, confidential:
 * its agents share nothing of it with other chats and learn nothing from it
 * (PAGE-305). The requested state shows at once.
 */
export function useConfidential(
  opened: OpenedConversation | null,
): ConfidentialControl {
  const marker = useFetcher();
  const target = confidentialTarget(opened);
  const requested = marker.formData;
  const isRequested =
    target !== null && requested?.get(target.field) === target.id;
  const isConfidential = isRequested
    ? requested.get("isConfidential") === "true"
    : (target?.isConfidential ?? null);

  function onToggle(): void {
    if (target === null || isConfidential === null) return;
    const formData = new FormData();
    formData.set("intent", "confidential");
    formData.set(target.field, target.id);
    formData.set("isConfidential", String(!isConfidential));
    void marker.submit(formData, { method: "post" });
  }

  return { isConfidential, onToggle };
}

/** Switches the mark of the opened chat; it shows only for chats with agents. */
export function ConfidentialButton({
  control,
}: {
  readonly control: ConfidentialControl | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!control || control.isConfidential === null) return null;
  const Icon = control.isConfidential ? ShieldCheck : ShieldOff;
  return (
    <Button
      aria-pressed={control.isConfidential}
      onClick={control.onToggle}
      size="sm"
      type="button"
      variant="outline"
      title={t("chatPage.confidentialHint")}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {control.isConfidential
        ? t("chatPage.confidentialOn")
        : t("chatPage.confidentialOff")}
    </Button>
  );
}
