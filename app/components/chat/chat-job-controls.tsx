import { Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { ChatJobs } from "./use-chat-job";

interface ChatJobControlProps {
  readonly jobs: ChatJobs;
}

/** Stops the running job; only this button ends it, closing the panel never does. */
export function ChatJobStopButton({
  jobs,
}: ChatJobControlProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (!jobs.isRunning) return null;
  return (
    <Button onClick={jobs.stop} variant="outline">
      <Square aria-hidden="true" className="size-4" />
      {t("chat.job.stop")}
    </Button>
  );
}

/** Tells that a message sent now joins the running answer instead of waiting for it. */
export function ChatJobSteerHint({
  jobs,
}: ChatJobControlProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (!jobs.isRunning) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {t("chat.job.steerHint")}
    </p>
  );
}
