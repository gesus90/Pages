import { useTranslation } from "react-i18next";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { parseInstant } from "@/app/lib/region-format";

import { ChatErrorNotice } from "./chat-error-notice";
import { chatErrorText } from "./chat-error";
import { isChatJobRunning } from "./chat-job-state";
import { ChatLiveStatus } from "./chat-live-status";
import { ChatPrivilegedActions } from "./chat-privileged-actions";
import { PicaMascot } from "./pica-mascot";

import type { ChatJobFailureDetail } from "@/definition/ChatJob";
import type { ChatLiveJob } from "./chat-job-state";

interface ChatJobStatusProps {
  readonly live: ChatLiveJob;
  readonly isOpen: boolean;
  readonly showLiveStatus: boolean;
}

function hideImages(): boolean {
  return false;
}

/**
 * The start of the request being answered: the follow-up turn if one runs,
 * otherwise the job. Stored times are UTC text without a zone.
 */
function requestStart(live: ChatLiveJob): number {
  return (
    parseInstant(live.turnStartedAt ?? live.job.createdAt)?.getTime() ??
    Number.NaN
  );
}

function ChatJobFailure({
  code,
  detail,
}: {
  readonly code: string;
  readonly detail: ChatJobFailureDetail | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const description = [
    detail?.step,
    detail?.cause,
    detail?.tool,
    detail?.diagnostic,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="mt-0.5 block text-xs font-normal">
      {chatErrorText(t, detail?.cause ?? code)}
      {detail ? (
        <span className="mt-0.5 block">
          {t(`chat.job.failureStage.${detail.stage}`)}
          {description ? ` (${description})` : null}
        </span>
      ) : null}
    </span>
  );
}

/** Activity while running; afterwards the actual failure or stop and any unsaved answer. */
export function ChatJobStatus({
  live,
  isOpen,
  showLiveStatus,
}: ChatJobStatusProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (isChatJobRunning(live)) {
    if (live.readError !== null)
      return <ChatErrorNotice code={live.readError} />;
    if (!showLiveStatus) return <ChatPrivilegedActions tools={live.tools} />;
    return (
      <div className="space-y-1">
        <ChatLiveStatus startedAt={requestStart(live)} isOpen={isOpen} />
        <ChatPrivilegedActions tools={live.tools} />
      </div>
    );
  }
  const state = live.ended?.state ?? live.job.state;
  if (state === "completed") return null;
  const errorCode = live.ended?.errorCode ?? live.job.errorCode;
  return (
    <div className="space-y-1">
      <article aria-label={t("chat.title")} className="flex gap-2">
        <PicaMascot className="mt-1 size-7" />
        <div className="min-w-0 max-w-[85%] space-y-2 rounded-2xl bg-surface px-3 py-2 ring-1 ring-border">
          <p className="text-sm font-medium text-destructive" role="alert">
            {t(`chat.job.ended.${state}`)}
            {state === "failed" && errorCode ? (
              <ChatJobFailure
                code={errorCode}
                detail={live.ended?.errorDetail ?? live.job.errorDetail ?? null}
              />
            ) : null}
          </p>
          {live.text ? (
            <div>
              <p className="text-xs text-muted-foreground">
                {t("chat.job.partial")}
              </p>
              <WikiMarkdown
                isDisplayableImage={hideImages}
                source={live.text}
              />
            </div>
          ) : null}
        </div>
      </article>
      <ChatPrivilegedActions tools={live.tools} />
    </div>
  );
}
