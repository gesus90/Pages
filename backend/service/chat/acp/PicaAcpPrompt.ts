import { picaTurnPrompt } from "./PicaAcpContent";

import type { PromptCapabilities } from "@agentclientprotocol/sdk";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpSelections } from "./PicaAcpSelections";
import type { PicaAcpMessage } from "./PicaAcpSteering";

/** Keeps negotiated attachment capabilities and constructs each job's prompt. */
export class PicaAcpPrompt {
  private readonly selections: PicaAcpSelections;
  private readonly usage: () => string;
  private readonly supportsImages: boolean | undefined;
  private capabilities: PromptCapabilities | null | undefined;

  public constructor(
    selections: PicaAcpSelections,
    usage: () => string,
    supportsImages?: boolean,
  ) {
    this.selections = selections;
    this.usage = usage;
    this.supportsImages = supportsImages;
  }

  /** Applies capabilities negotiated by a fresh or reused native session. */
  public negotiated(capabilities: PromptCapabilities | null | undefined): void {
    this.capabilities =
      this.supportsImages === false
        ? { ...capabilities, image: false }
        : capabilities;
  }

  /** Builds the prompt and its once-recorded attachment payload. */
  public create(
    message: PicaAcpMessage,
    brief: PicaTurnBrief,
  ): Pick<AgentPlanExecutionInput, "prompt" | "promptContent"> {
    return {
      prompt: [
        picaTurnPrompt(brief, message.text, message.attachments),
        this.usage(),
      ].join("\n\n"),
      promptContent: async (capabilities) => {
        this.negotiated(capabilities);
        const content = await this.selections.read(message, this.capabilities);
        await this.selections.select(message.id, content.items);
        return content.blocks;
      },
    };
  }

  /** Uses the same negotiated capability for a message sent during a turn. */
  public read(message: PicaAcpMessage): ReturnType<PicaAcpSelections["read"]> {
    return this.selections.read(message, this.capabilities);
  }
}
