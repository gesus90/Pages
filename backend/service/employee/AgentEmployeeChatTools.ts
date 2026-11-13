import type { PicaAcpStart } from "../chat/acp/PicaAcpService";
import type { User } from "@/definition/User";
import type {
  AgentChatScope,
  AgentEmployeeSessionDependencies,
} from "./AgentEmployeeSessionTypes";

type ChatToolDependencies = Pick<
  AgentEmployeeSessionDependencies,
  | "agentChat"
  | "chatReader"
  | "conversationContext"
  | "logbook"
  | "recipes"
  | "toolGuard"
>;

/** The chat tools a turn of an agent employee receives. */
export type ChatTools = Pick<
  NonNullable<PicaAcpStart["employee"]>,
  | "agentChat"
  | "readConversationContext"
  | "readOwnChat"
  | "logbook"
  | "recipes"
>;

/**
 * Builds the chat tools of a turn. Every tool that needs the chat of the
 * agent is offered only when the turn owns that chat.
 */
export function chatToolsOf(
  dependencies: ChatToolDependencies,
  agent: User,
  chat: AgentChatScope,
): ChatTools {
  const logbook = dependencies.logbook?.() ?? null;
  const agentChat = dependencies.agentChat?.() ?? null;
  const readContext = conversationReader(dependencies, agent);
  return {
    ...agentChatTool(dependencies, agentChat, chat),
    ...conversationContextTool(dependencies, readContext, chat),
    ...ownChatTools(dependencies, { agent, chat, logbook }),
  };
}

function conversationReader(
  dependencies: ChatToolDependencies,
  agent: User,
): ((input: unknown) => Promise<unknown>) | null {
  const { conversationContext } = dependencies;
  if (!conversationContext) return null;
  return (input: unknown): Promise<unknown> =>
    conversationContext.readForAgent(agent.id, input);
}

function agentChatTool(
  dependencies: ChatToolDependencies,
  agentChat: ReturnType<NonNullable<ChatToolDependencies["agentChat"]>> | null,
  chat: AgentChatScope,
): Pick<ChatTools, "agentChat"> {
  if (!agentChat) return {};
  return {
    agentChat:
      dependencies.toolGuard?.tools(agentChat, chat.scope) ?? agentChat,
  };
}

function conversationContextTool(
  dependencies: ChatToolDependencies,
  readContext: ((input: unknown) => Promise<unknown>) | null,
  chat: AgentChatScope,
): Pick<ChatTools, "readConversationContext"> {
  if (!readContext) return {};
  return {
    readConversationContext:
      dependencies.toolGuard?.contextReader(readContext, chat.scope) ??
      readContext,
  };
}

function ownChatTools(
  dependencies: ChatToolDependencies,
  turn: {
    readonly agent: User;
    readonly chat: AgentChatScope;
    readonly logbook: ReturnType<
      NonNullable<ChatToolDependencies["logbook"]>
    > | null;
  },
): Pick<ChatTools, "readOwnChat" | "logbook" | "recipes"> {
  const { own } = turn.chat;
  const { agent, logbook } = turn;
  const { chatReader, recipes } = dependencies;
  if (!own) return {};
  return {
    ...(chatReader
      ? {
          readOwnChat: (input: unknown) =>
            chatReader.read(own, agent.displayName, input),
        }
      : {}),
    ...(logbook
      ? {
          logbook: logbook.tools({
            agentId: agent.id,
            sessionId: own.sessionId,
          }),
        }
      : {}),
    ...(recipes
      ? {
          recipes: recipes.tools({
            agentId: agent.id,
            sessionId: own.sessionId,
          }),
        }
      : {}),
  };
}
