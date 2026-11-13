import { logbookChatLabel } from "./AgentLogbookService";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { PendingLogbookSession } from "@/backend/database/repositories/employee/AgentLogbookSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { AgentChatReader } from "./AgentChatReader";
import type { LogbookSummaryMessage } from "./AgentLogbookPrompt";
import type { AgentLogbookService } from "./AgentLogbookService";
import type { AgentMemoryModel } from "./AgentMemoryModel";

/** The messages one read of the chat takes, and how many reads one summary makes at most. */
const READ_PAGES = 5;
/** The newest entries of the chat the model sees, so it adds only what is missing. */
const EXISTING_ENTRIES = 30;

/** What the background summary reads, asks and writes. */
export interface AgentLogbookSummarizerDependencies {
  readonly store: Pick<
    EmployeeStore,
    "logbook" | "logbookSessions" | "employees"
  >;
  readonly users: Pick<UserRepository, "findById">;
  readonly reader: Pick<AgentChatReader, "read">;
  /** The model call; a function, because the sessions it runs on are wired after the summary. */
  readonly model: () => Pick<AgentMemoryModel, "logbook">;
  readonly logbook: Pick<AgentLogbookService, "record">;
  /** The model the instance names for the summary; `null` without one. */
  readonly instanceModel: () => Promise<{
    readonly connectionId: string;
    readonly model: string;
  } | null>;
  readonly now?: () => Date;
}

/** How a summary ended. */
export type AgentLogbookSummaryOutcome =
  /** The messages were read and their entries written; the session is done until its next round. */
  | { readonly status: "done"; readonly saved: number }
  /** The model gave no usable answer, so the chat stays due and is tried again later. */
  | { readonly status: "retry" };

/**
 * The background summary of a quiet chat for the Lagebuch (PAGE-377).
 *
 * @remarks
 * It reads the messages of the chat since its last summary, asks a model for
 * the entries the Lagebuch lacks and writes them with the origin
 * "background". The model is the one set for the agent, else the one of the
 * instance, else the agent's own. The run is a short session of its own beside
 * the chat sessions and never loads them. A chat that is confidential is never
 * read; a backlog of more than a few pages is worked off over several runs.
 */
export class AgentLogbookSummarizer {
  private readonly dependencies: AgentLogbookSummarizerDependencies;

  public constructor(dependencies: AgentLogbookSummarizerDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Summarizes the new messages of one chat.
   *
   * @param session - The chat session that has been quiet since its last round.
   */
  public async summarize(
    session: PendingLogbookSession,
  ): Promise<AgentLogbookSummaryOutcome> {
    const { store, users } = this.dependencies;
    const startedAt = this.now().toISOString();
    const [agent, employee] = await Promise.all([
      users.findById(session.agentId),
      store.employees().find(session.agentId),
    ]);
    if (agent?.isAgent !== true || !agent.isActive || !employee) {
      await this.finish(session, session.through, startedAt);
      return { status: "done", saved: 0 };
    }
    const read = await this.readNewMessages(session, agent.displayName);
    if (read.messages.length === 0) {
      await this.finish(session, session.through, startedAt);
      return { status: "done", saved: 0 };
    }
    const chat = { kind: session.kind, id: session.chatId, name: session.chatName };
    const existing = await store
      .logbook()
      .ofChat(session.agentId, chat, EXISTING_ENTRIES);
    const drafts = await this.dependencies.model().logbook(
      { agent, employee, model: await this.modelFor(session.agentId) },
      {
        chat: logbookChatLabel(chat),
        existing: existing.map((entry) => entry.text),
        messages: read.messages,
      },
    );
    if (drafts === null) return { status: "retry" };
    const recorded = await this.dependencies.logbook.record(
      session.agentId,
      chat,
      drafts,
      "background",
    );
    await this.finish(
      session,
      read.through,
      read.isComplete ? startedAt : null,
    );
    return { status: "done", saved: recorded.saved };
  }

  /** The model of the summary: the agent's choice, else the instance's, else none (the agent's own). */
  private async modelFor(agentId: string): Promise<
    | { readonly connectionId: string; readonly model: string }
    | undefined
  > {
    const settings = await this.dependencies.store.logbook().settings(agentId);
    if (settings?.connectionId && settings.model)
      return { connectionId: settings.connectionId, model: settings.model };
    return (await this.dependencies.instanceModel()) ?? undefined;
  }

  /** Reads the messages of the chat after the position of the last summary, a few pages at most. */
  private async readNewMessages(
    session: PendingLogbookSession,
    agentName: string,
  ): Promise<{
    readonly messages: LogbookSummaryMessage[];
    readonly through: number;
    readonly isComplete: boolean;
  }> {
    const messages: LogbookSummaryMessage[] = [];
    let through = session.through;
    for (let page = 0; page < READ_PAGES; page += 1) {
      const result = await this.dependencies.reader.read(
        { sessionId: session.sessionId, kind: session.kind, chatId: session.chatId },
        agentName,
        { ab: through },
      );
      for (const message of result.messages)
        messages.push({
          // A direct chat names the person's messages "person".
          from: message.from === "person" ? session.chatName : message.from,
          at: message.at,
          text: message.text,
        });
      through = result.messages.at(-1)?.nr ?? through;
      if (result.next === null) return { messages, through, isComplete: true };
    }
    return { messages, through, isComplete: false };
  }

  private async finish(
    session: PendingLogbookSession,
    through: number,
    processedAt: string | null,
  ): Promise<void> {
    await this.dependencies.store
      .logbookSessions()
      .saveProgress(session.sessionId, { through, processedAt });
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
