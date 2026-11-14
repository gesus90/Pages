import { agentImageTool } from "./AgentImageTool";
import { agentMediaTool } from "./AgentMediaTool";
import { agentAttachmentTool } from "./AgentAttachmentTool";

import type { PicaAcpStart } from "../chat/acp/PicaAcpService";
import type { AgentImageToolDependencies, AgentImageTurn } from "./AgentImageTool";
import type { AgentMediaToolDependencies } from "./AgentMediaTool";
import type { AgentAttachmentToolDependencies } from "./AgentAttachmentTool";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
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

/**
 * `bilder_erzeugen` of a round in a conversation (PAGE-382), bound to the
 * model of the round; a run of the agent's own and a direct chat outside the
 * conversations get none.
 *
 * @param images - The generation and storage of images; absent offers none.
 * @param turn - The agent, the conversation of the round or `null`, and the
 * model of the round.
 */
export function imageToolOf(
  images: AgentImageToolDependencies | undefined,
  turn: Omit<AgentImageTurn, "conversationId"> & {
    readonly conversationId: string | null;
  },
): Pick<NonNullable<PicaAcpStart["employee"]>, "generateImages"> {
  const { conversationId } = turn;
  if (!images || conversationId === null) return {};
  return {
    generateImages: agentImageTool(images, { ...turn, conversationId }),
  };
}

/**
 * `video_erzeugen` and `audio_erzeugen` of a round in a conversation
 * (PAGE-384), bound to the model of the round; a run of the agent's own and a
 * direct chat outside the conversations get none.
 *
 * @param media - The generation and storage of videos and sounds; absent offers none.
 * @param turn - The agent, the conversation of the round or `null`, and the
 * model of the round.
 */
export function mediaToolOf(
  media: AgentMediaToolDependencies | undefined,
  turn: Omit<AgentImageTurn, "conversationId"> & {
    readonly conversationId: string | null;
  },
): Pick<NonNullable<PicaAcpStart["employee"]>, "generateMedia"> {
  const { conversationId } = turn;
  if (!media || conversationId === null) return {};
  return {
    generateMedia: agentMediaTool(media, { ...turn, conversationId }),
  };
}

/**
 * `anhaenge_suchen` and `anhang_lesen` of a round in a conversation
 * (PAGE-386), bound to that conversation; whether the model sees images comes
 * from its catalog entry. A run of the agent's own and a direct chat outside
 * the conversations get none.
 *
 * @param attachments - The library of the attachments; absent offers none.
 * @param turn - The agent, the conversation of the round or `null`, and the
 * model of the round.
 */
export function attachmentToolOf(
  attachments: AgentAttachmentToolDependencies | null | undefined,
  turn: {
    readonly agentId: string;
    readonly conversationId: string | null;
    readonly assignment: Pick<ResolvedAgentAssignment, "supportsImages">;
  },
): Pick<NonNullable<PicaAcpStart["employee"]>, "readAttachments"> {
  const { conversationId } = turn;
  if (!attachments || conversationId === null) return {};
  return {
    readAttachments: agentAttachmentTool(attachments, {
      agentId: turn.agentId,
      conversationId,
      // Unknown counts as able: the adapter still decides what reaches the model.
      canSeeImages: turn.assignment.supportsImages !== false,
    }),
  };
}
