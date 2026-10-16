import { useTranslation } from "react-i18next";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";

import { chatErrorText } from "./chat-error";
import { isChatJobRunning } from "./chat-job-state";
import { PicaMascot } from "./pica-mascot";

import type { TFunction } from "i18next";
import type {
  ChatCost,
  ChatJobCompactionEvent,
  ChatJobToolEvent,
  ChatJobUsage,
} from "@/definition/ChatJob";
import type { ChatLiveJob } from "./chat-job-state";

interface ChatJobStatusProps {
  readonly live: ChatLiveJob;
}

function hideImages(): boolean {
  return false;
}

/** What the job does now, or how it ended when it did not complete. */
function ChatJobHeadline({ live }: ChatJobStatusProps): React.ReactElement {
  const { t } = useTranslation();
  if (isChatJobRunning(live))
    return (
      <p className="text-sm font-medium">
        {t(`chat.job.phase.${live.phase ?? "starting"}`)}
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {t("chat.job.background")}
        </span>
      </p>
    );
  const state = live.ended?.state ?? live.job.state;
  const errorCode = live.ended?.errorCode ?? live.job.errorCode;
  return (
    <p className="text-sm font-medium text-destructive" role="alert">
      {t(`chat.job.ended.${state}`)}
      {state === "failed" && errorCode ? (
        <span className="mt-0.5 block text-xs font-normal">
          {chatErrorText(t, errorCode)}
        </span>
      ) : null}
    </p>
  );
}

/** The Pages tools of the current turn with their status; never their arguments or results. */
function ChatJobTools({
  tools,
}: {
  readonly tools: readonly ChatJobToolEvent[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (tools.length === 0) return null;
  return (
    <ul aria-label={t("chat.job.tools")} className="flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <li
          key={tool.callId}
          className={cn(
            "rounded-full bg-muted px-2 py-0.5 text-xs",
            tool.status === "failed" && "text-destructive",
          )}
        >
          {t(`chat.job.tool.${tool.status}`, {
            tool: tool.tool,
            error: tool.error ?? "",
          })}
        </li>
      ))}
    </ul>
  );
}

/**
 * The latest context compaction of the agent session (PAGE-90); it is neither
 * a Pages tool nor a stop and ends no answer.
 */
function ChatJobCompaction({
  compaction,
}: {
  readonly compaction: ChatJobCompactionEvent | null;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  if (compaction === null) return null;
  const format = (count: number | null): string =>
    count === null
      ? t("chat.job.usage.unavailable")
      : count.toLocaleString(i18n.language);
  return (
    <p
      className={cn(
        "text-xs text-muted-foreground",
        compaction.status === "failed" && "text-destructive",
      )}
    >
      {t(`chat.job.compaction.${compaction.status}`, {
        before: format(compaction.tokensBefore),
        after: format(compaction.tokensAfter),
      })}
    </p>
  );
}

/** A reported cost, or the adapter's own estimate marked as such. */
function costText(t: TFunction, cost: ChatCost, language: string): string {
  const amount = `${cost.amount.toLocaleString(language)} ${cost.currency}`;
  const described = cost.isEstimated
    ? t("chat.job.usage.costEstimated", { amount })
    : amount;
  return cost.scope === "session"
    ? t("chat.job.usage.costSession", { amount: described })
    : described;
}

/** Consumption exactly as the adapter reported it; a missing value reads as unavailable. */
export function ChatJobUsageLine({
  usage,
}: {
  readonly usage: ChatJobUsage;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const format = (count: number): string => count.toLocaleString(i18n.language);
  const unavailable = t("chat.job.usage.unavailable");
  const context = usage.context
    ? t("chat.job.usage.contextValue", {
        used: format(usage.context.used),
        size: format(usage.context.size),
      })
    : unavailable;
  const tokens = usage.tokens
    ? t(
        usage.tokens.isPartial
          ? "chat.job.usage.tokensPartial"
          : "chat.job.usage.tokensValue",
        {
          input: format(usage.tokens.input),
          output: format(usage.tokens.output),
          total: format(usage.tokens.total),
        },
      )
    : unavailable;
  const cost = usage.cost
    ? costText(t, usage.cost, i18n.language)
    : unavailable;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs text-muted-foreground">
      <dt>{t("chat.job.usage.context")}</dt>
      <dd>{context}</dd>
      <dt>{t("chat.job.usage.tokens")}</dt>
      <dd>{tokens}</dd>
      <dt>{t("chat.job.usage.cost")}</dt>
      <dd>{cost}</dd>
    </dl>
  );
}

/**
 * Pica's row for a job that runs on the server (PAGE-68): its stage, the
 * answer so far, the Pages tools, a context compaction and the consumption;
 * after a stop or a failure, how it ended and the unsaved partial answer.
 */
export function ChatJobStatus({
  live,
}: ChatJobStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const isRunning = isChatJobRunning(live);
  return (
    <article aria-label={t("chat.title")} className="flex gap-2">
      <PicaMascot className="mt-1 size-7" />
      <div
        aria-live="polite"
        className="min-w-0 max-w-[85%] space-y-2 rounded-2xl bg-surface px-3 py-2 ring-1 ring-border"
      >
        <ChatJobHeadline live={live} />
        {live.text ? (
          <div>
            {isRunning ? null : (
              <p className="text-xs text-muted-foreground">
                {t("chat.job.partial")}
              </p>
            )}
            <WikiMarkdown isDisplayableImage={hideImages} source={live.text} />
          </div>
        ) : null}
        <ChatJobTools tools={live.tools} />
        <ChatJobCompaction compaction={live.compaction} />
        <ChatJobUsageLine usage={live.usage} />
      </div>
    </article>
  );
}
