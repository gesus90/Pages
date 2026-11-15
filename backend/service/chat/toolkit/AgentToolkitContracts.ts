import type { z } from "zod";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentChatHistory } from "@/definition/AgentChatHistory";
import type { AgentChatInteractions } from "@/definition/AgentChatQuestion";
import type { AgentChatTasks } from "@/definition/AgentChatTask";
import type {
  AgentToolGroup,
  AgentToolPolicy,
} from "@/definition/AgentToolGroups";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { AgentShellJobs } from "./AgentShellJobs";
import type { AgentShellLauncher } from "./AgentShellLauncher";
import type { AgentWebPageReader } from "./AgentWebTools";

/** Parameters of a toolkit tool after its schema accepted them. */
export type AgentToolkitParameters = Readonly<Record<string, unknown>>;

/**
 * Everything the toolkit of one chat job works with (PAGE-390).
 *
 * @remarks
 * Pages derives every field from the stored agent and the job, never from
 * model input: the root is the working folder of the job, the policy comes
 * from the access level and the switched-off groups.
 */
export interface AgentToolkitJob {
  /** The account of the agent whose job runs, for the audit. */
  readonly agentId: string;
  /** The working folder: the agent's workspace or the folder of the chat session. */
  readonly root: string;
  readonly policy: AgentToolPolicy;
  /** Starts shell commands: inside the isolation for "Arbeitsplatz", directly for YOLO. */
  readonly launcher: AgentShellLauncher;
  /** The background runs of this job; they end with it. */
  readonly shellJobs: AgentShellJobs;
  /** Fetches a public web page; the default pins the address and refuses private hosts. */
  readonly readPage: AgentWebPageReader;
  /**
   * The interim messages and questions of the job, bound to its chat
   * (PAGE-391); absent for a run without a chat, which offers neither.
   */
  readonly interactions?: AgentChatInteractions;
  /**
   * The scheduled tasks of the job, bound to its agent and chat (PAGE-392);
   * absent for a run without a chat, which plans none.
   */
  readonly chatTasks?: AgentChatTasks;
  /**
   * The search over the earlier messages of the agent's chats (PAGE-393),
   * bound to its agent and chat; absent offers no history tools.
   */
  readonly history?: AgentChatHistory;
}

/** One tool of the toolkit, before Pages applies the policy. */
export interface AgentToolkitTool {
  readonly id: string;
  readonly group: AgentToolGroup;
  /** Whether the tool changes something; a group in `read` mode never offers it. */
  readonly isWrite: boolean;
  readonly description: string;
  readonly inputSchema: z.ZodType<AgentToolkitParameters>;
  /**
   * Whether this exact call is a consequential step (deleting, sending out,
   * paying and the like) that the person must approve in the chat first.
   */
  readonly isConsequential?: (parameters: AgentToolkitParameters) => boolean;
  readonly execute: (
    parameters: AgentToolkitParameters,
    job: AgentToolkitJob,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

/** A tool definition whose handlers receive the parsed input of its own schema. */
interface TypedToolkitTool<Schema extends z.ZodType<AgentToolkitParameters>> {
  readonly id: string;
  readonly group: AgentToolGroup;
  readonly isWrite: boolean;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly isConsequential?: (parameters: z.infer<Schema>) => boolean;
  readonly execute: (
    parameters: z.infer<Schema>,
    job: AgentToolkitJob,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

/**
 * Defines a toolkit tool whose handlers read the typed input of its schema.
 *
 * @remarks
 * The registry has validated the input already; parsing it once more here
 * narrows it without a cast.
 */
export function defineToolkitTool<
  Schema extends z.ZodType<AgentToolkitParameters>,
>(definition: TypedToolkitTool<Schema>): AgentToolkitTool {
  const { inputSchema, isConsequential, execute } = definition;
  return {
    id: definition.id,
    group: definition.group,
    isWrite: definition.isWrite,
    description: definition.description,
    inputSchema,
    ...(isConsequential
      ? {
          isConsequential: (parameters: AgentToolkitParameters) =>
            isConsequential(inputSchema.parse(parameters)),
        }
      : {}),
    execute: (parameters, job, context) =>
      execute(inputSchema.parse(parameters), job, context),
  };
}
