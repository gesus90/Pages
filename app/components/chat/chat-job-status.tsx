import { useTranslation } from "react-i18next";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";

import { chatErrorText } from "./chat-error";
import { isChatJobRunning } from "./chat-job-state";
import { ChatLiveStatus } from "./chat-live-status";
import { PicaMascot } from "./pica-mascot";

import type { ChatLiveJob } from "./chat-job-state";

interface ChatJobStatusProps {
  readonly live: ChatLiveJob;
  readonly isOpen: boolean;
}

function hideImages(): boolean {
  return false;
}

/** Activity while running; afterwards the actual failure or stop and any unsaved answer. */
export function ChatJobStatus({
  live,
  isOpen,
}: ChatJobStatusProps): React.ReactElement {
  const { t } = useTranslation();
  if (isChatJobRunning(live))
    return (
      <ChatLiveStatus
        startedAt={Date.parse(live.job.createdAt)}
        isOpen={isOpen}
      />
    );
  const state = live.ended?.state ?? live.job.state;
  const errorCode = live.ended?.errorCode ?? live.job.errorCode;
  return (
    <article aria-label={t("chat.title")} className="flex gap-2">
      <PicaMascot className="mt-1 size-7" />
      <div className="min-w-0 max-w-[85%] space-y-2 rounded-2xl bg-surface px-3 py-2 ring-1 ring-border">
        <p className="text-sm font-medium text-destructive" role="alert">
          {t(`chat.job.ended.${state}`)}
          {state === "failed" && errorCode ? (
            <span className="mt-0.5 block text-xs font-normal">
              {chatErrorText(t, errorCode)}
            </span>
          ) : null}
        </p>
        {live.text ? (
          <div>
            <p className="text-xs text-muted-foreground">
              {t("chat.job.partial")}
            </p>
            <WikiMarkdown isDisplayableImage={hideImages} source={live.text} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
