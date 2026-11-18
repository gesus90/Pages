import { randomUUID } from "node:crypto";

import { continuedPicaBrief } from "./PicaAcpContent";
import { chatMcpServers } from "./PicaAcpRunners";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpCredential } from "./PicaAcpCredential";
import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";
import type { PicaAcpJobSpecification } from "./PicaAcpJobSpecification";
import type { PicaAcpPooledInput } from "./PicaAcpPoolOpening";
import type { PicaAcpPrompt } from "./PicaAcpPrompt";
import type { PicaAcpMessage } from "./PicaAcpSteering";
import type { PicaAcpUpdates } from "./PicaAcpUpdates";

/** What a turn prompt and a session start read from the job. */
export interface PicaAcpInputSources {
  readonly specification: PicaAcpJobSpecification;
  readonly userId: string;
  readonly browsers: PicaAcpJobDependencies["agentBrowsers"];
  readonly credential: PicaAcpCredential;
  readonly prompt: PicaAcpPrompt;
  readonly updates: PicaAcpUpdates;
  readonly context: () => RuntimeExecutionContext;
  readonly authorize: () => Promise<void>;
}

/** The input of a follow-up turn; it keeps only the brief of a context that the agent session already knows. */
export function followUpPromptInput(
  message: PicaAcpMessage,
  sources: PicaAcpInputSources,
): AgentPlanExecutionInput {
  return {
    ...sources.prompt.create(
      message,
      continuedPicaBrief(sources.specification.brief),
    ),
    agent: sources.specification.agent,
    userId: sources.userId,
    directory: sources.specification.directory,
    beforeStart: () => sources.authorize(),
  };
}

/** The input that opens a new agent session for a job. */
export function sessionPromptInput(
  request: {
    readonly message: PicaAcpMessage;
    readonly brief: PicaTurnBrief;
    readonly resumeSessionId: string | null;
    readonly pooled: PicaAcpPooledInput | undefined;
  },
  sources: PicaAcpInputSources,
): AgentPlanSessionInput {
  const { agent, directory, run } = sources.specification;
  const { pooled, resumeSessionId } = request;
  return {
    ...sources.prompt.create(request.message, request.brief),
    agent,
    userId: sources.userId,
    directory,
    options: run.options,
    instanceId: randomUUID(),
    chat: {
      ...(sources.browsers
        ? {
            browserStateDirectory: sources.browsers.mount(sources.context()),
          }
        : {}),
      ...chatMcpServers(
        run.runner,
        () => pooled?.servers ?? sources.credential.mcpServers(),
      ),
      resumeSessionId,
      listener: pooled?.listener ?? sources.updates,
    },
    beforeStart: () => sources.authorize(),
  };
}
