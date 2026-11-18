import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { agentToolPolicy } from "@/definition/AgentToolGroups";

import { employeeAccessRun } from "./AgentEmployeeAccessRun";
import { agentIdentity } from "./AgentEmployeeAssignments";
import { chatToolsOf } from "./AgentEmployeeChatTools";
import { createAgentEmployeeInstructions } from "./AgentEmployeeInstructions";
import { isChatPurpose } from "./AgentEmployeeSessionTypes";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentChatHistory } from "@/definition/AgentChatHistory";
import type { AgentChatInteractions } from "@/definition/AgentChatQuestion";
import type { AgentChatTasks } from "@/definition/AgentChatTask";
import type { User } from "@/definition/User";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type {
  PicaAcpEmployeeRun,
  PicaAcpStart,
} from "../chat/acp/PicaAcpService";
import type { AgentChatContext } from "./AgentChatContext";
import type { AgentChatToolScope } from "./AgentChatToolGuard";
import type {
  AgentChatScope,
  AgentEmployeeSessionDependencies,
  AgentJobRequest,
} from "./AgentEmployeeSessionTypes";
import type { AgentMemoryAudience } from "./AgentMemorySharing";
import type { AgentRecipeBrief } from "./AgentRecipeService";

/** Parameters for building the runner of one agent job. */
export interface EmployeeRunSpec {
  readonly assignment: ResolvedAgentAssignment;
  /** The chat whose rules of sharing `memory_search` applies. */
  readonly audience: AgentMemoryAudience;
  readonly keptSession: PicaAcpEmployeeRun["keptSession"];
  /** The chat the job runs in. */
  readonly chat: AgentChatScope;
  /** The connection the job runs on, which stays the only one it may use. */
  readonly connectionId: string;
}

/**
 * What a round of a chat is told about the recipes of its agent;
 * a run of the agent's own gets none, and a failed read leaves them out.
 */
async function recipeBrief(
  dependencies: AgentEmployeeSessionDependencies,
  request: AgentJobRequest,
  isChat: boolean,
): Promise<AgentRecipeBrief | null> {
  const recipes = dependencies.recipes;
  if (!recipes || !isChat) return null;
  try {
    return await recipes.brief(request.agent.id, request.text);
  } catch (error: unknown) {
    logCaughtError("AgentEmployeeSessions", error);
    return null;
  }
}

/**
 * The hint line of the Lagebuch for a round of a chat. A run of
 * the agent's own has none, and a failed read leaves the line out.
 */
async function logbookHint(
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
    logCaughtError("AgentEmployeeSessions", error);
    return { line: null, newest: 0 };
  }
}

/**
 * Checks a running job against the current state of its agent: still
 * active and present; configuration changes apply to the next round.
 */
async function requireCurrentAgent(
  dependencies: AgentEmployeeSessionDependencies,
  agentId: string,
): Promise<void> {
  const [agent, employee] = await Promise.all([
    dependencies.users.findById(agentId),
    dependencies.store.employees().find(agentId),
  ]);
  if (!agent?.isActive || agent.isAgent !== true || !employee)
    throw new ChatError("accessDenied");
  // Configuration is pinned for this turn; the next round reads the new settings.
}

/**
 * The interim messages and questions, the scheduled tasks
 * and the history search of a job, bound to its
 * chat; a run of the agent's own has no chat and offers none of them.
 */
export function chatInteractionsFor(
  dependencies: AgentEmployeeSessionDependencies,
  agent: User,
  chat: AgentChatScope,
): {
  readonly interactions?: AgentChatInteractions;
  readonly chatTasks?: AgentChatTasks;
  readonly history?: AgentChatHistory;
} {
  const questions = dependencies.chatQuestions?.() ?? null;
  const tasks = dependencies.chatTasks?.() ?? null;
  const history = dependencies.chatHistory ?? null;
  const { own } = chat;
  if (!own) return {};
  const bound =
    own.kind === "direct"
      ? { kind: "direct" as const, personId: own.chatId }
      : {
          kind: "conversation" as const,
          conversationId: own.chatId,
          askerId: own.askerId ?? null,
        };
  return {
    ...(questions ? { interactions: questions.bind(agent.id, bound) } : {}),
    ...(tasks ? { chatTasks: tasks.bind(agent.id, bound) } : {}),
    ...(history
      ? {
          history: history.bind(
            agent.id,
            bound.kind === "direct"
              ? bound
              : {
                  kind: "conversation",
                  conversationId: bound.conversationId,
                },
          ),
        }
      : {}),
  };
}

/**
 * The instruction and the context of a job: a chat gets its
 * history after the summary, the summary, the topics of `MEMORY.md` and
 * the related archive entries the rules of sharing give it, and
 * `DREAM.md`; a run of the agent's own gets none of them.
 */
export async function buildEmployeeBrief(
  sources: {
    readonly dependencies: AgentEmployeeSessionDependencies;
    readonly context: AgentChatContext;
  },
  request: AgentJobRequest,
  sessionId: string,
): Promise<{
  readonly brief: PicaAcpStart["brief"];
  readonly audience: AgentMemoryAudience;
  /** The newest entry of the Lagebuch the round's hint line covers. */
  readonly logbookNewest: number;
}> {
  const { dependencies, context: chatContext } = sources;
  const { agent, employee, person } = request;
  const [identity, settings, context, hint] = await Promise.all([
    agentIdentity(dependencies, agent.id),
    person ? dependencies.languages.findByUserId(person.id) : null,
    chatContext.forJob(request, { sessionId, message: request.text }),
    logbookHint(dependencies, request, sessionId),
  ]);
  const recipes = await recipeBrief(dependencies, request, context.isChat);
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
        hasAdministratorRights: employee.hasAdministratorRights,
        toolPolicy: agentToolPolicy(
          employee.access,
          employee.disabledToolGroups,
        ),
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

/** Tells the session the entries of the Lagebuch its round just carried the hint line for. */
export async function markLogbookSeen(
  dependencies: AgentEmployeeSessionDependencies,
  sessionId: string,
  newest: number,
): Promise<void> {
  const logbook = dependencies.logbook?.();
  if (!logbook || newest <= 0) return;
  try {
    await logbook.markSeen(sessionId, newest);
  } catch (error: unknown) {
    // The hint is a courtesy: a failed note must not fail the round.
    logCaughtError("AgentEmployeeSessions", error);
  }
}

/**
 * Hands the finished answer of a direct chat to the memory:
 * the person's messages since the previous answer and the answer itself.
 */
export function recordEmployeeAnswer(
  dependencies: AgentEmployeeSessionDependencies,
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
    logCaughtError("AgentEmployeeSessions", error);
  });
}

/** The chat of a job as the chat tools and `chat_lesen` see it. */
export function chatScopeOf(
  request: AgentJobRequest,
  sessionId: string,
): AgentChatScope {
  const { purpose, person, conversationId } = request;
  const scope: AgentChatToolScope = {
    agentId: request.agent.id,
    conversationId:
      purpose === "conversation" ? (conversationId ?? null) : null,
  };
  if (purpose === "conversation" && conversationId !== undefined)
    return {
      scope,
      own: {
        sessionId,
        kind: "group",
        chatId: conversationId,
        ...(person && person.isAgent !== true ? { askerId: person.id } : {}),
      },
    };
  if (purpose === "chat" && person)
    return {
      scope,
      own: { sessionId, kind: "direct", chatId: person.id },
    };
  return { scope, own: null };
}

/**
 * The runner of a job of the agent's own with the agent's access level, see
 * {@link employeeAccessRun}, which a chat job shares.
 */
export async function buildEmployeeRun(
  dependencies: AgentEmployeeSessionDependencies,
  agent: User,
  employee: StoredAgentEmployee,
  job: EmployeeRunSpec,
): Promise<NonNullable<PicaAcpStart["employee"]>> {
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
    ...(keptSession ? { keptSession } : {}),
    // A run of the agent's own is short and carries no chat.
    ...(keptSession ? {} : { isFreshSession: true }),
    ...access,
    requireCurrent: () => requireCurrentAgent(dependencies, agent.id),
    requireConnection: (connectionId) =>
      connectionId === job.connectionId
        ? Promise.resolve()
        : Promise.reject(new ChatError("contextChanged")),
    searchMemory: async (query) => ({
      entries: await dependencies.memory.search(agent.id, query, audience),
    }),
  };
}
