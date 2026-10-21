import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";

interface ChatPasswordReceiptsProps {
  readonly receipts: readonly ChatTemporaryPassword[];
  readonly onDismiss: () => void;
}

/** One-time password display for the administrator; separate from persistent conversation messages. */
export function ChatPasswordReceipts({
  receipts,
  onDismiss,
}: ChatPasswordReceiptsProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (receipts.length === 0) return null;
  return (
    <ScrollViewport
      axis="vertical"
      containerClassName="max-h-[30dvh] shrink-0"
      className="space-y-2 overflow-y-auto border-t border-border bg-muted p-4"
      role="status"
    >
      <p className="text-sm text-muted-foreground">
        {t("chat.passwordReceipt.hint")}
      </p>
      {receipts.map((receipt) => (
        <label className="block space-y-1 text-sm" key={receipt.userId}>
          <span>
            {t("chat.passwordReceipt.label", { name: receipt.username })}
          </span>
          <Input
            className="font-mono"
            readOnly
            value={receipt.temporaryPassword}
          />
        </label>
      ))}
      <Button onClick={onDismiss} size="sm" variant="ghost">
        {t("chat.passwordReceipt.dismiss")}
      </Button>
    </ScrollViewport>
  );
}
