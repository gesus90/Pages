import { randomUUID } from "node:crypto";

import { chatMcpServers } from "./PicaAcpRunners";
import { picaTurnPrompt } from "./PicaAcpContent";

import type { PromptCapabilities } from "@agentclientprotocol/sdk";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpCredential } from "./PicaAcpCredential";
import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";
import type { PicaAcpJobSpecification } from "./PicaAcpJobSpecification";
import type { PicaAcpPooledInput } from "./PicaAcpPoolOpening";
import type { PicaAcpSelections } from "./PicaAcpSelections";
import type { PicaAcpMessage } from "./PicaAcpSteering";
import type { PicaAcpUpdates } from "./PicaAcpUpdates";

/** What a turn prompt and a session start read from the job. */
export interface PicaAcpInputSources {
  readonly specification: PicaAcpJobSpecification;
  readonly userId: string;
  readonly browsers: PicaAcpJobDependencies["agentBrowsers"];
  readonly credential: PicaAcpCredential;
  readonly selections: PicaAcpSelections;
  readonly updates: PicaAcpUpdates;
  readonly context: () => RuntimeExecutionContext;
  readonly authorize: () => Promise<void>;
  readonly setCapabilities: (
    capabilities: PromptCapabilities | null | undefined,
  ) => void;
}

/** The prompt and the content blocks of one turn. */
export function turnPromptInput(
  message: PicaAcpMessage,
  brief: PicaTurnBrief,
  sources: PicaAcpInputSources,
): Pick<AgentPlanExecutionInput, "prompt" | "promptContent"> {
  return {
    prompt: [
      picaTurnPrompt(brief, message.text, message.attachments),
      sources.credential.usage(),
      sources.browsers?.usage(sources.context()) ?? "",
    ].join("\n\n"),
    promptContent: async (capabilities) => {
      sources.setCapabilities(capabilities);
      const content = await sources.selections.read(message, capabilities);
      await sources.selections.select(message.id, content.items);
      return content.blocks;
    },
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
    ...turnPromptInput(request.message, request.brief, sources),
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
      ...(run.runner.isUnisolated === true ? { isUnisolated: true } : {}),
      resumeSessionId,
      listener: pooled?.listener ?? sources.updates,
    },
    beforeStart: () => sources.authorize(),
  };
}
