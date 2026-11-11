import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";

/**
 * Deletes an own stored message with its attachments and their preview
 * images (PAGE-298): the bin asks once more before the message is gone for
 * every member.
 *
 * @param messageId - The stored message of the signed-in person.
 */
export function MessageDelete({
  messageId,
}: {
  readonly messageId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isAsking, setAsking] = useState(false);
  const deleter = useFetcher();

  function handleDelete(): void {
    const formData = new FormData();
    formData.set("intent", "delete-message");
    formData.set("messageId", messageId);
    void deleter.submit(formData, { method: "post" });
    setAsking(false);
  }

  if (!isAsking)
    return (
      <button
        aria-label={t("chatPage.deleteMessage.label")}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 hover:bg-muted hover:text-destructive focus-visible:opacity-100"
        disabled={deleter.state !== "idle"}
        onClick={() => setAsking(true)}
        title={t("chatPage.deleteMessage.label")}
        type="button"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
    );
  return (
    <span className="flex items-center gap-1.5">
      <Button onClick={handleDelete} size="xs" variant="destructive-soft">
        {t("chatPage.deleteMessage.confirm")}
      </Button>
      <Button onClick={() => setAsking(false)} size="xs" variant="ghost">
        {t("chatPage.deleteMessage.cancel")}
      </Button>
    </span>
  );
}
