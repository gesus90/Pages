import type { PicaAdminService } from "../admin/PicaAdminService";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { ChatSessionService } from "../ChatSessionService";
import type { ChatToolExecutor } from "../ChatToolExecutor";
import type { PicaBridge } from "./PicaBridge";
import type { PicaAnswerFiles } from "./PicaAcpAnswerOutput";
import type { PicaAttachmentReader } from "./PicaAcpContent";

/** What a job needs from Pages; every write path is an existing one. */
export interface PicaAcpJobDependencies {
  readonly adminTools?: PicaAdminService;
  readonly requireCurrent?: (
    userId: string,
    assignment: ResolvedAgentAssignment,
  ) => Promise<void>;
  readonly plans: Pick<PlanExecution, "open">;
  readonly jobs: Pick<
    ChatJobRepository,
    "append" | "finish" | "saveContext" | "saveTurn"
  >;
  readonly steers: Pick<ChatSteerRepository, "update" | "select" | "answer">;
  readonly acpSessions: Pick<ChatAcpSessionRepository, "save">;
  readonly messages: Pick<ChatSessionRepository, "append" | "messages">;
  readonly attachments: PicaAttachmentReader;
  readonly bridge: Pick<PicaBridge, "open">;
  readonly tools: Pick<ChatToolExecutor, "run">;
  /** The scope of the connection, checked again before every tool call. */
  readonly access: ExecutionAuthorizer;
  readonly sessions: Pick<ChatSessionService, "require" | "confirmationWord">;
  /** Files Pica writes or returns for its answers, linked once an answer is stored (PAGE-92). */
  readonly answerFiles?: PicaAnswerFiles;
}
