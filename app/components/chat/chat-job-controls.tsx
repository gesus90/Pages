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
    <Button
      className="gap-1 px-1.5 text-sm xl:gap-1.5 xl:px-3"
      onClick={jobs.stop}
      variant="outline"
    >
      <Square aria-hidden="true" className="size-4" />
      {t("chat.job.stop")}
    </Button>
  );
}
