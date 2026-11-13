import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_SUMMARY_LIMITS } from "@/definition/ConversationObserver";

import { observerContextBlock } from "./ConversationObserverRouting";
import {
  observerLine,
  readSummaryAnswer,
  summaryPrompt,
} from "./ConversationObserverPrompts";

import type {
  ConversationGroupContextRepository,
  StoredGroupContext,
} from "@/backend/database/repositories/conversation/ConversationGroupContextRepository";
import type {
  ConversationMessageRepository,
  StoredConversationMessage,
} from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { ConversationSummarySource } from "@/definition/ConversationObserver";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type { ConversationObserverModel } from "./ConversationObserverModel";
import type {
  ObserverLine,
  SummaryContent,
  SummaryMaterial,
} from "./ConversationObserverPrompts";

const COMPONENT = "ConversationGroupSummaries";

/** Groups one tick looks at, the most recently active first. */
const GROUPS_PER_TICK = 20;

/** After a failed attempt a group waits this long before the next one. */
const FAILURE_PAUSE_MILLISECONDS = 30 * 60_000;
/** Quota may recover before other failures: try again on the next regular tick. */
const QUOTA_PAUSE_MILLISECONDS =
  CONVERSATION_SUMMARY_LIMITS.intervalMilliseconds;

/** What the summaries of groups read, ask and store. */
export interface ConversationGroupSummariesDependencies {
  readonly contexts: Pick<
    ConversationGroupContextRepository,
    | "find"
    | "saveSummary"
    | "recordFailure"
    | "invalidate"
    | "candidates"
    | "changedSources"
    | "pendingCount"
  >;
  readonly messages: Pick<ConversationMessageRepository, "contentAfter">;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly rounds: Pick<ConversationRoundRepository, "findByReply">;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly model: Pick<ConversationObserverModel, "ask">;
  readonly now?: () => Date;
}

/** The next messages a summary takes, without a gap and without skipping an unread one. */
interface SummaryWindow {
  readonly messages: readonly StoredConversationMessage[];
  readonly lines: readonly ObserverLine[];
  readonly hasExcerpts: boolean;
}

function isValidSummary(stored: StoredGroupContext | null): boolean {
  return (
    stored !== null &&
    stored.throughSequence > 0 &&
    (stored.status === "current" || stored.status === "behind")
  );
}

/** The sources after one more window: the newest windows with their message IDs, older ones as one range. */
function nextSources(
  previous: readonly ConversationSummarySource[],
  window: readonly StoredConversationMessage[],
): ConversationSummarySource[] {
  const [first] = window;
  const last = window.at(-1);
  if (!first || !last) return [...previous];
  const sources = [
    ...previous,
    {
      fromSequence: first.sequence,
      toSequence: last.sequence,
      messageIds: window.map((message) => message.id),
    },
  ];
  while (sources.length > CONVERSATION_SUMMARY_LIMITS.sourceRanges) {
    const [oldest, next, ...rest] = sources;
    if (!oldest || !next) break;
    sources.splice(
      0,
      sources.length,
      {
        fromSequence: oldest.fromSequence,
        toSequence: next.toSequence,
        messageIds: [],
      },
      ...rest,
    );
  }
  return sources;
}

/**
 * Keeps the stored context of each group with agents (PAGE-296).
 *
 * @remarks
 * Only a group with an active agent member and content messages after its
 * stored sequence is summarized; an unchanged group costs no model call. A
 * summary takes the previous summary and the next window of messages,
 * oldest first and without a gap. It stops before a voice message whose
 * text is still being recognized, so the stored sequence never moves past
 * an unread message. A longer backlog goes on window by window, a few per
 * tick, and stays marked as behind meanwhile. When a summarized message
 * changed or vanished, the summary is dropped and built anew from the
 * messages that remain. A failed attempt keeps the previous summary, is
 * recorded and waits before the next one; it is never repeated at once.
 */
export class ConversationGroupSummaries {
  private readonly dependencies: ConversationGroupSummariesDependencies;

  public constructor(dependencies: ConversationGroupSummariesDependencies) {
    this.dependencies = dependencies;
  }

  /** Drops the summaries whose messages changed, then summarizes every group that waits. */
  public async runDue(): Promise<void> {
    await this.invalidateChanged();
    const candidates =
      await this.dependencies.contexts.candidates(GROUPS_PER_TICK);
    for (const candidate of candidates) {
      try {
        await this.summarize(candidate.conversationId);
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);
      }
    }
  }

  /** Drops every summary whose summarized messages changed or vanished. */
  public async invalidateChanged(): Promise<void> {
    const { contexts } = this.dependencies;
    for (const conversationId of await contexts.changedSources())
      await contexts.invalidate(conversationId, this.now());
  }

  /** Summarizes the waiting windows of one group, a few per tick. */
  private async summarize(conversationId: string): Promise<void> {
    for (
      let windows = 0;
      windows < CONVERSATION_SUMMARY_LIMITS.windowsPerTick;
      windows += 1
    ) {
      const isDone = await this.summarizeWindow(conversationId);
      if (isDone) return;
    }
  }

  /** @returns `true` when nothing more waits now, or an attempt failed. */
  private async summarizeWindow(conversationId: string): Promise<boolean> {
    const { contexts } = this.dependencies;
    const stored = await contexts.find(conversationId);
    if (this.isPaused(stored)) return true;
    const previous = isValidSummary(stored) ? stored : null;
    const through = previous?.throughSequence ?? 0;
    const accounts = await this.dependencies.directory.read();
    const window = await this.window(conversationId, through, accounts);
    const [first] = window.messages;
    const last = window.messages.at(-1);
    if (!first || !last) return true;
    const people = await this.people(conversationId, window, accounts);
    const conversation = people.groupName;
    if (people.ids.length === 0 || conversation === null) {
      await this.fail(conversationId, previous, "observer_no_person");
      return true;
    }
    const content = await this.ask({
      conversationId,
      personIds: people.ids,
      trigger: `summary:${String(first.sequence)}-${String(last.sequence)}`,
      material: {
        groupName: conversation,
        previous: observerContextBlock(previous),
        lines: window.lines,
      },
    });
    if ("code" in content) {
      await this.fail(conversationId, previous, content.code);
      return true;
    }
    return this.save(conversationId, {
      revision: stored?.revision ?? 0,
      previous,
      window,
      content,
    });
  }

  /**
   * Stores the new summary against the revision it was built on.
   *
   * @returns `true` when nothing more waits, or the stored context changed meanwhile.
   */
  private async save(
    conversationId: string,
    built: {
      readonly revision: number;
      readonly previous: StoredGroupContext | null;
      readonly window: SummaryWindow;
      readonly content: SummaryContent;
    },
  ): Promise<boolean> {
    const { contexts } = this.dependencies;
    const { previous, window } = built;
    const through = window.messages.at(-1)?.sequence ?? 0;
    const pending = await contexts.pendingCount(conversationId, through);
    const isSaved = await contexts.saveSummary(
      conversationId,
      {
        ...built.content,
        sources: nextSources(previous?.sources ?? [], window.messages),
        throughSequence: through,
        hasExcerpts: (previous?.hasExcerpts ?? false) || window.hasExcerpts,
        status: pending > 0 ? "behind" : "current",
        updatedAt: this.now(),
      },
      built.revision,
    );
    return !isSaved || pending === 0;
  }

  /** Asks the observer once; a failure comes back as its code. */
  private async ask(question: {
    readonly conversationId: string;
    readonly personIds: readonly string[];
    readonly trigger: string;
    readonly material: SummaryMaterial;
  }): Promise<SummaryContent | { readonly code: string }> {
    try {
      return readSummaryAnswer(
        await this.dependencies.model.ask({
          ...question,
          prompt: summaryPrompt(question.material),
          material: { kind: "summary", summary: question.material },
        }),
      );
    } catch (error: unknown) {
      if (!(error instanceof ConversationObserverError)) throw error;
      return { code: error.code };
    }
  }

  /** The next window after the stored sequence, within the fixed limits. */
  private async window(
    conversationId: string,
    through: number,
    accounts: ConversationAccounts,
  ): Promise<SummaryWindow> {
    const limits = CONVERSATION_SUMMARY_LIMITS;
    const page = await this.dependencies.messages.contentAfter(
      conversationId,
      through,
      limits.windowMessages,
    );
    const messages: StoredConversationMessage[] = [];
    const lines: ObserverLine[] = [];
    let characters = 0;
    for (const message of page) {
      // A text still being recognized is unread; the window ends before it.
      if (message.voice?.transcriptionState === "pending") break;
      const line = observerLine(
        message,
        accounts.participant(message.senderId),
        limits.messageExcerptCharacters,
      );
      const length = Array.from(line.text).length;
      if (lines.length > 0 && characters + length > limits.windowCharacters)
        break;
      characters += length;
      messages.push(message);
      lines.push(line);
    }
    return {
      messages,
      lines,
      hasExcerpts: lines.some((line) => line.isExcerpt),
    };
  }

  /**
   * The people whose content the window holds, the newest first: the authors
   * of its messages, and for an answer of an agent the person of its round.
   * Only active members count; nobody else stands in.
   */
  private async people(
    conversationId: string,
    window: SummaryWindow,
    accounts: ConversationAccounts,
  ): Promise<{ readonly ids: string[]; readonly groupName: string | null }> {
    const ids: string[] = [];
    let groupName: string | null = null;
    for (const message of [...window.messages].reverse()) {
      const personId = await this.personOf(message, accounts);
      if (personId === null || ids.includes(personId)) continue;
      const account = accounts.find(personId);
      if (!account || account.user.isAgent === true || !account.isAvailable)
        continue;
      const conversation = await this.dependencies.conversations.findForMember(
        conversationId,
        personId,
      );
      if (conversation?.kind !== "group") continue;
      groupName = conversation.name;
      ids.push(personId);
    }
    return { ids, groupName };
  }

  private async personOf(
    message: StoredConversationMessage,
    accounts: ConversationAccounts,
  ): Promise<string | null> {
    if (accounts.find(message.senderId)?.user.isAgent !== true)
      return message.senderId;
    const origin = await this.dependencies.rounds.findByReply(message.id);
    return origin?.personId ?? null;
  }

  private isPaused(stored: StoredGroupContext | null): boolean {
    if (!stored?.errorCode || !stored.attemptedAt) return false;
    if (stored.status === "rebuilding" && stored.errorCode === "source_changed")
      return false;
    const elapsed =
      (this.dependencies.now?.() ?? new Date()).getTime() -
      Date.parse(stored.attemptedAt);
    const pause =
      stored.errorCode === "provider_quota_exhausted"
        ? QUOTA_PAUSE_MILLISECONDS
        : FAILURE_PAUSE_MILLISECONDS;
    return elapsed >= 0 && elapsed < pause;
  }

  private async fail(
    conversationId: string,
    previous: StoredGroupContext | null,
    errorCode: string,
  ): Promise<void> {
    await this.dependencies.contexts.recordFailure(conversationId, {
      status: previous ? "behind" : "unavailable",
      errorCode,
      attemptedAt: this.now(),
    });
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
