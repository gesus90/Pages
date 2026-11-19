import { z } from "zod";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  AGENT_QUESTION_LIMITS,
  AGENT_QUESTION_TIMEOUT_DEFAULT_MINUTES,
  AGENT_QUESTION_TIMEOUT_RANGE_MINUTES,
} from "@/definition/AgentChatQuestion";

import { isTicketArchiveOperation } from "../PicaArchiveConfirmation";
import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";

import { toolkitRefusal, toolkitResult } from "./AgentToolkitOutcome";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type {
  AgentChatInteractions,
  AgentQuestionConfirmation,
  AgentQuestionOutcome,
} from "@/definition/AgentChatQuestion";
import type { PicaArchiveConfirmation } from "../PicaArchiveConfirmation";
import type { PicaPlanConfirmation } from "../PicaPlanConfirmation";
import type { PicaToolOutcome } from "../PicaToolSchemas";

/** The tool with which an agent writes an interim message during its round. */
export const AGENT_SAY_TOOL = "nachricht_senden";

/** The tool with which an agent asks the people of its chat with answer buttons. */
export const AGENT_ASK_TOOL = "rueckfrage";

const SAY_SCHEMA = z
  .object({
    text: z.string().trim().min(1).max(AGENT_QUESTION_LIMITS.interimCharacters),
  })
  .strict();

const ASK_SCHEMA = z
  .object({
    questions: z
      .array(
        z
          .object({
            question: z
              .string()
              .trim()
              .min(1)
              .max(AGENT_QUESTION_LIMITS.questionCharacters),
            options: z
              .array(
                z
                  .string()
                  .trim()
                  .min(1)
                  .max(AGENT_QUESTION_LIMITS.optionCharacters),
              )
              .min(AGENT_QUESTION_LIMITS.options.minimum)
              .max(AGENT_QUESTION_LIMITS.options.maximum),
            recommended: z
              .number()
              .int()
              .min(0)
              .max(AGENT_QUESTION_LIMITS.options.maximum - 1)
              .optional(),
            multiple: z.boolean().optional(),
          })
          .strict(),
      )
      .min(AGENT_QUESTION_LIMITS.questions.minimum)
      .max(AGENT_QUESTION_LIMITS.questions.maximum),
    timeoutMinutes: z
      .number()
      .int()
      .min(AGENT_QUESTION_TIMEOUT_RANGE_MINUTES.minimum)
      .max(AGENT_QUESTION_TIMEOUT_RANGE_MINUTES.maximum)
      .optional(),
    confirms: z
      .object({
        tool: z.string().min(1).max(200),
        parameters: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

type SayParameters = z.infer<typeof SAY_SCHEMA>;
type AskParameters = z.infer<typeof ASK_SCHEMA>;

const SAY_DESCRIPTION =
  'Write a short interim message to your chat now, without ending your round, e.g. what you are working on ("Bin dran, Tests laufen …"). Your final answer still follows as usual. Use it sparingly for longer work; never for the final answer.';

const ASK_DESCRIPTION = `Ask the people of your chat 1 to 3 questions with 2 to 4 answer buttons each and wait for the answer; your round continues with it. Put your recommended answer at index \`recommended\` (it is shown first and highlighted); \`multiple\` allows several answers. People can always answer in free text instead. Without an answer within \`timeoutMinutes\` (default ${String(AGENT_QUESTION_TIMEOUT_DEFAULT_MINUTES)}) continue at your own discretion and say so. To confirm a consequential step Pages held back with CONFIRMATION_REQUIRED, ask exactly one question whose recommended option performs it (e.g. "Löschen") next to one that cancels it ("Abbrechen"), and pass the held-back \`tool\` and \`parameters\` unchanged as \`confirms\`; if the person chooses it, repeat the identical call.`;

/** What the agent should do after its question ended. */
function instruction(
  outcome: AgentQuestionOutcome,
  confirmation: { readonly isAsked: boolean; readonly isApproved: boolean },
): string {
  if (outcome.status === "cancelled") return "Your round ended.";
  if (outcome.status === "expired")
    return confirmation.isAsked
      ? "Nobody answered in time. Do not perform the step; tell the chat that it was not confirmed."
      : "Nobody answered in time. Continue at your own discretion and tell the chat in your answer that you decided without an answer and what you chose.";
  if (!confirmation.isAsked)
    return "Continue your work with this answer; the free text, if any, takes precedence over the buttons.";
  return confirmation.isApproved
    ? "The person approved the step: repeat the identical call now."
    : "The person did not approve the step: do not perform it.";
}

/** Whether the answer chose the recommended option of the only question, without a free text that could say otherwise. */
function isApproving(outcome: AgentQuestionOutcome): boolean {
  if (outcome.status !== "answered") return false;
  const [answer] = outcome.answers;
  return answer?.isRecommendedChosen === true && answer.freeText === null;
}

/** What the tools of interim messages and questions are registered with. */
export interface AgentChatInteractionParts {
  readonly interactions: AgentChatInteractions;
  /** The approvals of consequential steps the confirmation of a question grants. */
  readonly approvals: PicaPlanConfirmation;
  readonly archiveConfirmations?: PicaArchiveConfirmation | undefined;
  /** The human message of the turn; its ID binds a granted approval to the turn. */
  readonly turnId: string | undefined;
  readonly admit: (context: RuntimeExecutionContext) => Promise<boolean>;
}

/** Maps a refusal of the conversation to the code the agent receives. */
function refusalOf(error: unknown): PicaToolOutcome {
  if (error instanceof ConversationError)
    return toolkitRefusal(
      error.code === "too_long" ? "INVALID_REQUEST" : "CHAT_UNAVAILABLE",
    );
  throw error;
}

async function say(
  parts: AgentChatInteractionParts,
  parameters: SayParameters,
  context: RuntimeExecutionContext,
): Promise<PicaToolOutcome> {
  if (!(await parts.admit(context))) return toolkitRefusal("STEP_LIMIT");
  try {
    const sent = await parts.interactions.say(parameters.text);
    return toolkitResult({
      messageId: sent.messageId,
      delivery: "shown in your chat now; your round continues",
    });
  } catch (error: unknown) {
    return refusalOf(error);
  }
}

/** Reserves a held call for this card and returns how its answer settles the call. */
function claimConfirmation(
  parts: AgentChatInteractionParts,
  confirmation: AgentQuestionConfirmation,
  context: RuntimeExecutionContext,
): ((isApproved: boolean) => boolean) | null {
  const action = {
    operation: confirmation.tool,
    parameters: confirmation.parameters,
  };
  if (parts.archiveConfirmations && isTicketArchiveOperation(action.operation))
    return parts.archiveConfirmations.claimQuestion(action, context);
  if (!parts.approvals.isHeld(action, context)) return null;
  return (isApproved: boolean): boolean =>
    isApproved &&
    parts.approvals.grant(action, context, parts.turnId ?? context.runId);
}

function isInvalidConfirmation(parameters: AskParameters): boolean {
  return Boolean(
    parameters.confirms &&
    (parameters.questions.length !== 1 || parameters.questions[0]?.multiple),
  );
}

async function ask(
  parts: AgentChatInteractionParts,
  parameters: AskParameters,
  context: RuntimeExecutionContext,
): Promise<PicaToolOutcome> {
  if (!(await parts.admit(context))) return toolkitRefusal("STEP_LIMIT");
  const confirmation = parameters.confirms ?? null;
  if (isInvalidConfirmation(parameters))
    return toolkitRefusal("INVALID_REQUEST", {
      reason: "A confirmation asks exactly one single-choice question.",
    });
  const settleConfirmation = confirmation
    ? claimConfirmation(parts, confirmation, context)
    : null;
  if (confirmation && !settleConfirmation)
    return toolkitRefusal("NOT_HELD", {
      reason:
        "No matching call is waiting for a new confirmation card. Use the exact tool and parameters from CONFIRMATION_REQUIRED. If you already asked for this call, do not ask again.",
    });
  let outcome: AgentQuestionOutcome;
  try {
    outcome = await parts.interactions.ask(
      {
        items: parameters.questions.map((question) => ({
          text: question.question,
          options: question.options,
          recommended: question.recommended ?? 0,
          isMultipleChoice: question.multiple === true,
        })),
        timeoutMinutes:
          parameters.timeoutMinutes ?? AGENT_QUESTION_TIMEOUT_DEFAULT_MINUTES,
        confirmation,
      },
      context.signal,
    );
  } catch (error: unknown) {
    settleConfirmation?.(false);
    return refusalOf(error);
  }
  const isApproved = settleConfirmation?.(isApproving(outcome)) ?? false;
  return toolkitResult({
    ...outcome,
    ...(confirmation ? { confirmed: isApproved } : {}),
    instruction: instruction(outcome, {
      isAsked: confirmation !== null,
      isApproved,
    }),
  });
}

/**
 * Registers `nachricht_senden` and `rueckfrage` of an agent employee's job
 * Interim messages during a round and questions with answer
 * buttons, which also confirm consequential steps.
 */
export function registerAgentChatInteractionTools(
  registry: RuntimeToolRegistry,
  parts: AgentChatInteractionParts,
): void {
  registry.register<SayParameters, PicaToolOutcome>({
    id: AGENT_SAY_TOOL,
    description: SAY_DESCRIPTION,
    inputSchema: SAY_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) => say(parts, parameters, context),
  });
  registry.register<AskParameters, PicaToolOutcome>({
    id: AGENT_ASK_TOOL,
    description: ASK_DESCRIPTION,
    inputSchema: ASK_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) => ask(parts, parameters, context),
  });
}
