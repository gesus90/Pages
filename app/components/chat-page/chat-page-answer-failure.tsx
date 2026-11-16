import { ChevronRight, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";

interface ChatPageAnswerFailureProps {
  /** The stored hint of the failed answer. */
  readonly messageId: string;
  /** The stored explanation of the hint, such as the tool and its diagnostic. */
  readonly reason: string;
}

/**
 * Why the answer of an agent failed, folded under "Warum?", and the button
 * that starts the answer once more.
 * @remarks
 * Pages already repeated a passing failure once on its own; this hint shows
 * only when that did not help. A press removes the hint and the answer runs
 * again for the same message.
 */
export function ChatPageAnswerFailure({
  messageId,
  reason,
}: ChatPageAnswerFailureProps): React.ReactElement {
  const { t } = useTranslation();
  const retrier = useFetcher();
  const isRetrying = retrier.state !== "idle";

  function handleRetry(): void {
    const formData = new FormData();
    formData.set("intent", "retry-answer");
    formData.set("messageId", messageId);
    void retrier.submit(formData, { method: "post" });
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-2 text-xs text-muted-foreground">
      {reason === "" ? null : (
        <details className="group min-w-0">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
            />
            <span>{t("chatPage.failure.why")}</span>
          </summary>
          <p className="mt-1 rounded-lg bg-muted px-3 py-2 break-words">
            {reason}
          </p>
        </details>
      )}
      <Button
        disabled={isRetrying}
        onClick={handleRetry}
        size="xs"
        variant="outline"
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
        {isRetrying
          ? t("chatPage.failure.retrying")
          : t("chatPage.failure.retry")}
      </Button>
    </div>
  );
}
