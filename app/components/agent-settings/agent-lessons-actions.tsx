import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentRowKind } from "./agent-lessons-display";

interface AgentRowActionsProps {
  readonly kind: AgentRowKind;
  /** What the buttons act on: the start of the lesson or the name of the recipe. */
  readonly subject: string;
  readonly isActive: boolean;
  /** Whether a change runs now; every button waits for it. */
  readonly isBusy: boolean;
  /** The action of this row that runs now, for its spinner. */
  readonly pendingAction: "toggle" | "remove" | null;
  readonly onEdit: () => void;
  readonly onToggle: () => void;
  /** Deletes the entry; called only after the confirmation. */
  readonly onRemove: () => void;
}

/** "Wirklich löschen?" with the buttons that confirm or call it off. */
function RemoveConfirmation({
  kind,
  subject,
  isBusy,
  pendingAction,
  onRemove,
  onCancel,
}: Pick<
  AgentRowActionsProps,
  "kind" | "subject" | "isBusy" | "pendingAction" | "onRemove"
> & { readonly onCancel: () => void }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t(`agentLessons.actionFor.${kind}.remove`, { subject })}
      className="flex flex-wrap items-center gap-2"
      role="group"
    >
      <span className="text-sm font-medium text-foreground">
        {t("agentLessons.actions.confirmQuestion")}
      </span>
      <Button
        aria-label={t(`agentLessons.actionFor.${kind}.confirmRemove`, {
          subject,
        })}
        disabled={isBusy}
        isPending={pendingAction === "remove"}
        onClick={onRemove}
        size="xs"
        variant="destructive"
      >
        {t("agentLessons.actions.confirmRemove")}
      </Button>
      <Button disabled={isBusy} onClick={onCancel} size="xs" variant="outline">
        {t("agentLessons.actions.cancel")}
      </Button>
    </div>
  );
}

/**
 * The buttons of one lesson or recipe: edit, switch on or off, and delete,
 * which asks "Wirklich löschen?" once before it sends anything.
 */
export function AgentRowActions({
  kind,
  subject,
  isActive,
  isBusy,
  pendingAction,
  onEdit,
  onToggle,
  onRemove,
}: AgentRowActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);
  const toggleAction = isActive ? "deactivate" : "activate";
  if (isConfirming)
    return (
      <RemoveConfirmation
        kind={kind}
        subject={subject}
        isBusy={isBusy}
        pendingAction={pendingAction}
        onRemove={onRemove}
        onCancel={() => setIsConfirming(false)}
      />
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        aria-label={t(`agentLessons.actionFor.${kind}.edit`, { subject })}
        disabled={isBusy}
        onClick={onEdit}
        size="xs"
        variant="outline"
      >
        {t("agentLessons.actions.edit")}
      </Button>
      <Button
        aria-label={t(`agentLessons.actionFor.${kind}.${toggleAction}`, {
          subject,
        })}
        disabled={isBusy}
        isPending={pendingAction === "toggle"}
        onClick={onToggle}
        size="xs"
        variant="outline"
      >
        {t(`agentLessons.actions.${toggleAction}`)}
      </Button>
      <Button
        aria-label={t(`agentLessons.actionFor.${kind}.remove`, { subject })}
        disabled={isBusy}
        onClick={() => setIsConfirming(true)}
        size="xs"
        variant="outline"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {t("agentLessons.actions.remove")}
      </Button>
    </div>
  );
}
