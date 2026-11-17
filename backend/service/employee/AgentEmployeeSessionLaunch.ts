import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { chatInteractionsFor } from "./AgentEmployeeJobRun";

import { employeeAccessRun } from "./AgentEmployeeAccessRun";
import { createAgentEmployeeInstructions } from "./AgentEmployeeInstructions";
import { agentIdentity } from "./AgentEmployeeAssignments";
import {
  answerFileToolOf,
  attachmentToolOf,
  chatToolsOf,
  imageToolOf,
  mediaToolOf,
} from "./AgentEmployeeChatTools";
import {
  isChatPurpose,
  type AgentChatScope,
  type AgentEmployeeSessionDependencies,
  type AgentJobRequest,
} from "./AgentEmployeeSessionTypes";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { User } from "@/definition/User";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type {
  PicaAcpEmployeeRun,
  PicaAcpStart,
} from "../chat/acp/PicaAcpService";
import type { AgentChatContext } from "./AgentChatContext";
import type { AgentMemoryAudience } from "./AgentMemorySharing";
import type { AgentRecipeBrief } from "./AgentRecipeService";

const COMPONENT = "AgentEmployeeSessions";

async function recipeBriefOf(
  dependencies: AgentEmployeeSessionDependencies,
  request: AgentJobRequest,
  isChat: boolean,
): Promise<AgentRecipeBrief | null> {
  const recipes = dependencies.recipes;
  if (!recipes || !isChat) return null;
  try {
    return await recipes.brief(request.agent.id, request.text);
  } catch (error: unknown) {
    logCaughtError(COMPONENT, error);
    return null;
  }
}

async function logbookHintOf(
  dependencies: AgentEmployeeSessionDependencies,
  request: AgentJobRequest,
  sessionId: string,
): Promise<{ readonly line: string | null; readonly newest: number }> {
  const logbook = dependencies.logbook?.();
  if (!logbook || !isChatPurpose(request.purpose))
    return { line: null, newest: 0 };
  try {
    return await logbook.hint({ agentId: request.agent.id, sessionId });
  } catch (error: unknown) {
    logCaughtError(COMPONENT, error);
    return { line: null, newest: 0 };
  }
}

/**
 * The instruction and the context of a job: a chat gets its
 * history after the summary, the summary, the topics of `MEMORY.md` and
 * the related archive entries the rules of sharing give it, and
 * `DREAM.md`; a run of the agent's own gets none of them.
 */
export async function buildEmployeeBrief(
  dependencies: AgentEmployeeSessionDependencies,
  chatContext: AgentChatContext,
  request: AgentJobRequest,
  sessionId: string,
): Promise<{
  readonly brief: PicaAcpStart["brief"];
  readonly audience: AgentMemoryAudience;
  /** The newest entry of the Lagebuch the round's hint line covers. */
  readonly logbookNewest: number;
}> {
  const { agent, employee, person } = request;
  const [identity, settings, context, hint] = await Promise.all([
    agentIdentity(dependencies, agent.id),
    person ? dependencies.languages.findByUserId(person.id) : null,
    chatContext.forJob(request, { sessionId, message: request.text }),
    logbookHintOf(dependencies, request, sessionId),
  ]);
  const recipes = await recipeBriefOf(dependencies, request, context.isChat);
  return {
    audience: context.audience,
    logbookNewest: hint.newest,
    brief: {
      instructions: createAgentEmployeeInstructions({
        name: agent.displayName,
        ...identity,
        soul: employee.soul,
        instructions: employee.instructions,
        memory: context.memory,
        dream: context.dream,
        related: context.related,
        access: employee.access,
        personName: context.isChat ? (person?.displayName ?? null) : null,
        hasLogbook:
          context.isChat && (dependencies.logbook?.() ?? null) !== null,
        logbookHint: hint.line,
        ...(recipes ? { recipes } : {}),
      }),
      // A continued agent session knows its chat; only a new or restarted one
      // gets the summary and the last messages.
      keepsContext: false,
      prompt: {
        personName: person?.displayName ?? agent.displayName,
        interfaceLanguage: settings?.language ?? "de",
        today: dependencies.today?.() ?? new Date().toISOString().slice(0, 10),
        // A run of the agent's own reads its sources from the message alone.
        history: context.history,
        summary: context.summary,
        nativeTools: true,
        assistantName: agent.displayName,
      },
    },
  };
}

/**
 * Hands the finished answer of a direct chat to the memory:
 * the person's messages since the previous answer and the answer itself.
 */
export function recordEmployeeAnswer(
  dependencies: Pick<AgentEmployeeSessionDependencies, "recorder" | "messages">,
  request: AgentJobRequest,
  sessionId: string,
): void {
  const { recorder } = dependencies;
  const { person } = request;
  if (!recorder || request.purpose !== "chat" || !person) return;
  void withBackgroundDatabaseWork("agent_memory_answer", async () => {
    const transcript = await dependencies.messages.messages(sessionId);
    const answer = transcript.at(-1);
    if (answer?.role !== "assistant") return;
    const previous = transcript
      .slice(0, -1)
      .findLastIndex((message) => message.role === "assistant");
    const message = transcript
      .slice(previous + 1, -1)
      .map((entry) => entry.content)
      .join("\n\n");
    await recorder.record({
      agent: request.agent,
      chat: { kind: "person", personId: person.id },
      chatLabel: `Chat mit ${person.displayName}`,
      personName: person.displayName,
      message,
      answer: answer.content,
      sessionId,
    });
  }).catch((error: unknown) => {
    logCaughtError(COMPONENT, error);
  });
}

/**
 * The runner of a chat job with the agent's access level, see
 * {@link employeeAccessRun}, which a job of the agent's own shares.
 */
export async function buildEmployeeRun(
  dependencies: AgentEmployeeSessionDependencies,
  requireCurrent: () => Promise<void>,
  account: {
    readonly agent: User;
    readonly employee: StoredAgentEmployee;
  },
  job: {
    readonly assignment: ResolvedAgentAssignment;
    /** The chat whose rules of sharing `memory_search` applies. */
    readonly audience: AgentMemoryAudience;
    readonly keptSession: PicaAcpEmployeeRun["keptSession"];
    /** The chat the job runs in. */
    readonly chat: AgentChatScope;
    /** The connection the job runs on, which stays the only one it may use. */
    readonly connectionId: string;
  },
): Promise<NonNullable<PicaAcpStart["employee"]>> {
  const { agent, employee } = account;
  const { assignment, audience, keptSession, chat } = job;
  const access = await employeeAccessRun(
    dependencies,
    { agent, employee },
    {
      assignment,
      chatTools: chatInteractionsFor(dependencies, agent, chat),
    },
  );
  return {
    // The chat tools stay bound to the job's chat: a confidential chat keeps
    // its own session and `chat_lesen` reads only that chat.
    ...chatToolsOf(dependencies, agent, chat),
    ...imageToolOf(dependencies.images, {
      agentId: agent.id,
      conversationId: chat.scope.conversationId,
      employee,
      assignment,
    }),
    ...mediaToolOf(dependencies.media, {
      agentId: agent.id,
      conversationId: chat.scope.conversationId,
      employee,
      assignment,
    }),
    ...answerFileToolOf(dependencies.answerFiles, {
      agentId: agent.id,
      conversationId: chat.scope.conversationId,
    }),
    ...attachmentToolOf(dependencies.attachments?.(), {
      agentId: agent.id,
      conversationId: chat.scope.conversationId,
      assignment,
    }),
    ...(keptSession ? { keptSession } : {}),
    // A run of the agent's own is short and carries no chat.
    ...(keptSession ? {} : { isFreshSession: true }),
    ...access,
    requireCurrent,
    requireConnection: (connectionId) =>
      connectionId === job.connectionId
        ? Promise.resolve()
        : Promise.reject(new ChatError("contextChanged")),
    searchMemory: async (query) => ({
      entries: await dependencies.memory.search(agent.id, query, audience),
    }),
  };
}
