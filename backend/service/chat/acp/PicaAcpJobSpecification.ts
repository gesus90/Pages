import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { User } from "@/definition/User";
import type { PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpJobPool } from "./PicaAcpPoolOpening";
import type { PicaAcpRunner } from "./PicaAcpRunners";
import type { PicaAcpMessage } from "./PicaAcpSteering";

/** The runner of a job and the run options it was validated with before anything was stored. */
export interface PicaAcpRun {
  readonly runner: PicaAcpRunner;
  readonly options: AgentRunOptions;
}

/** One job: the conversation, the pinned agent and the message it answers. */
export interface PicaAcpJobSpecification {
  readonly id: string;
  readonly actor: User;
  readonly sessionId: string;
  readonly agent: ResolvedAgentAssignment;
  readonly run: PicaAcpRun;
  /** The fixed working directory of the conversation. */
  readonly directory: string;
  readonly message: PicaAcpMessage;
  /** Instructions and context with the transcript, for a new agent session. */
  readonly brief: PicaTurnBrief;
  /** The agent session to continue; `null` starts a new one. */
  readonly resumeSessionId: string | null;
  /** Runs a task in the queue of the conversation. */
  readonly gate: <Result>(task: () => Promise<Result>) => Promise<Result>;
  /** The chat session of an agent employee kept between rounds (PAGE-335); absent opens one per job. */
  readonly pool?: PicaAcpJobPool;
}
