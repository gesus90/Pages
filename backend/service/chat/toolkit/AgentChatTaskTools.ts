import { z } from "zod";

import { AgentChatTaskError } from "@/backend/error/AgentChatTaskError";
import {
  AGENT_CHAT_TASK_KINDS,
  AGENT_CHAT_TASK_TEXT_LENGTH,
} from "@/definition/AgentChatTask";

import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";

import { toolkitRefusal, toolkitResult } from "./AgentToolkitOutcome";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type {
  AgentChatTaskReceipt,
  AgentChatTasks,
} from "@/definition/AgentChatTask";
import type { AgentToolGroupMode } from "@/definition/AgentToolGroups";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { AgentToolkitParameters } from "./AgentToolkitContracts";

/** The tool with which an agent plans a reminder or a recurring task from its chat. */
export const AGENT_TASK_CREATE_TOOL = "aufgabe_planen";
/** The tool that lists the agent's planned tasks of its chat. */
export const AGENT_TASK_LIST_TOOL = "aufgaben_auflisten";
/** The tool that changes, pauses or resumes a planned task. */
export const AGENT_TASK_UPDATE_TOOL = "aufgabe_aendern";
/** The tool that deletes a planned task. */
export const AGENT_TASK_DELETE_TOOL = "aufgabe_loeschen";

/** The tools of scheduled tasks that change something. */
export const AGENT_TASK_WRITE_TOOLS: readonly string[] = [
  AGENT_TASK_CREATE_TOOL,
  AGENT_TASK_UPDATE_TOOL,
  AGENT_TASK_DELETE_TOOL,
];

const TEXT = z.string().trim().min(1).max(AGENT_CHAT_TASK_TEXT_LENGTH);

const LOCAL_TIME = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u, "YYYY-MM-DDTHH:MM");

const CLOCK = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "HH:MM");

const SCHEDULE = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), at: LOCAL_TIME }).strict(),
  z
    .object({
      type: z.literal("interval"),
      every: z.number().int().min(1).max(365),
      unit: z.enum(["minute", "hour", "day"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("weekly"),
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      times: z.array(CLOCK).min(1).max(12),
    })
    .strict(),
]);

const CREATE_SCHEMA = z
  .object({
    kind: z.enum(AGENT_CHAT_TASK_KINDS),
    request: TEXT,
    instruction: TEXT.optional(),
    schedule: SCHEDULE,
  })
  .strict();

const LIST_SCHEMA = z.object({}).strict();

const UPDATE_SCHEMA = z
  .object({
    taskId: z.string().min(1).max(200),
    request: TEXT.optional(),
    instruction: TEXT.optional(),
    schedule: SCHEDULE.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const DELETE_SCHEMA = z.object({ taskId: z.string().min(1).max(200) }).strict();

type CreateParameters = z.infer<typeof CREATE_SCHEMA>;
type UpdateParameters = z.infer<typeof UPDATE_SCHEMA>;
type DeleteParameters = z.infer<typeof DELETE_SCHEMA>;

const SCHEDULE_HELP =
  '`schedule` is in the wall-clock time of the person who asked; Pages applies their time zone: `{type:"once", at:"YYYY-MM-DDTHH:MM"}`, `{type:"interval", every, unit:"minute"|"hour"|"day"}` (at least 5 minutes) or `{type:"weekly", weekdays:[1..7, 1 = Monday], times:["HH:MM"]}`. Event triggers are not available from a chat.';

const CREATE_DESCRIPTION = `Plan a reminder or a recurring task in this chat when a person asks for it ("Erinnere mich morgen um 9 an X", "Prüfe jeden Montag die offenen Tickets"). \`kind\` "reminder" only reminds the person, "task" has you work on \`instruction\` at the time. \`request\` is the person's request in their words. ${SCHEDULE_HELP} At the time you are woken in your session of this chat and your answer is posted here. After planning, confirm the time to the person in plain words exactly as \`when\` says (e.g. "Morgen, 16.11., 9:00 Uhr").`;

const LIST_DESCRIPTION =
  "List your planned reminders and tasks of this chat with their ID, rhythm (`when`), next run and whether they are paused.";

const UPDATE_DESCRIPTION = `Change one of your planned tasks of this chat by \`taskId\`: its request, instruction or schedule, or pause (\`active: false\`) and resume it (\`active: true\`). ${SCHEDULE_HELP} Confirm the new time in plain words as \`when\` says.`;

const DELETE_DESCRIPTION =
  "Delete one of your planned tasks of this chat by `taskId`. Deleting is a consequential step that the person approves first.";

/** What the tools of scheduled tasks are registered with. */
export interface AgentChatTaskToolParts {
  readonly tasks: AgentChatTasks;
  /** The mode of the Pages group of the agent; `read` only lists. */
  readonly mode: AgentToolGroupMode;
  readonly admit: (context: RuntimeExecutionContext) => Promise<boolean>;
  /** Asks for the person's approval of a deletion; `null` lets it run. */
  readonly requireApproval: (call: {
    readonly tool: string;
    readonly parameters: AgentToolkitParameters;
    readonly context: RuntimeExecutionContext;
  }) => PicaToolOutcome | null;
}

/** The answer of a planned or changed task, with what the agent confirms. */
function receiptResult(receipt: AgentChatTaskReceipt): PicaToolOutcome {
  return toolkitResult({
    taskId: receipt.task.id,
    kind: receipt.task.kind,
    request: receipt.task.request,
    when: receipt.when,
    isActive: receipt.task.isActive,
    nextRunAt: receipt.task.nextRunAt,
    instruction: `Confirm to the person in plain words: ${receipt.when}.`,
  });
}

const REFUSALS: Readonly<Record<AgentChatTaskError["code"], string>> = {
  not_found: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  limit_reached: "LIMIT_REACHED",
  time_in_past: "TIME_IN_PAST",
  invalid: "INVALID_REQUEST",
  run_active: "RUN_ACTIVE",
};

const REASONS: Readonly<Partial<Record<AgentChatTaskError["code"], string>>> = {
  forbidden:
    "Only a person who addressed you in this chat can have a task planned; nothing was planned.",
  limit_reached:
    "This chat holds the most planned tasks it may. Tell the person; they can delete one first.",
  time_in_past: "The time has passed. Ask the person for a time in the future.",
};

/** Maps a refusal of the tasks to the code the agent receives. */
function refusalOf(error: unknown): PicaToolOutcome {
  if (!(error instanceof AgentChatTaskError)) throw error;
  const reason = REASONS[error.code];
  return toolkitRefusal(
    REFUSALS[error.code],
    reason === undefined ? undefined : { reason },
  );
}

/** Runs one call after the step budget admitted it; refusals become answers. */
async function guarded(
  parts: AgentChatTaskToolParts,
  context: RuntimeExecutionContext,
  run: () => Promise<PicaToolOutcome>,
): Promise<PicaToolOutcome> {
  if (!(await parts.admit(context))) return toolkitRefusal("STEP_LIMIT");
  context.signal.throwIfAborted();
  try {
    return await run();
  } catch (error: unknown) {
    return refusalOf(error);
  }
}

function registerWrites(
  registry: RuntimeToolRegistry,
  parts: AgentChatTaskToolParts,
): void {
  registry.register<CreateParameters, PicaToolOutcome>({
    id: AGENT_TASK_CREATE_TOOL,
    description: CREATE_DESCRIPTION,
    inputSchema: CREATE_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      guarded(parts, context, async () =>
        receiptResult(
          await parts.tasks.create({
            kind: parameters.kind,
            request: parameters.request,
            instruction: parameters.instruction ?? parameters.request,
            schedule: parameters.schedule,
          }),
        ),
      ),
  });
  registry.register<UpdateParameters, PicaToolOutcome>({
    id: AGENT_TASK_UPDATE_TOOL,
    description: UPDATE_DESCRIPTION,
    inputSchema: UPDATE_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      guarded(parts, context, async () => {
        const { taskId, active, schedule, ...texts } = parameters;
        return receiptResult(
          await parts.tasks.update(taskId, {
            ...texts,
            ...(schedule ? { schedule } : {}),
            ...(active === undefined ? {} : { isActive: active }),
          }),
        );
      }),
  });
  registry.register<DeleteParameters, PicaToolOutcome>({
    id: AGENT_TASK_DELETE_TOOL,
    description: DELETE_DESCRIPTION,
    inputSchema: DELETE_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (parameters, context) =>
      guarded(parts, context, async () => {
        const prompt = parts.requireApproval({
          tool: AGENT_TASK_DELETE_TOOL,
          parameters,
          context,
        });
        if (prompt) return prompt;
        await parts.tasks.remove(parameters.taskId);
        return toolkitResult({ taskId: parameters.taskId, isDeleted: true });
      }),
  });
}

/**
 * Registers the tools of scheduled tasks of an agent employee's job in its
 * chat: `aufgabe_planen`, `aufgaben_auflisten`, `aufgabe_aendern`
 * and `aufgabe_loeschen`.
 *
 * @remarks
 * They follow the Pages group of the agent's access level: off
 * offers none, `read` only the list, `full` every tool. Deleting is a
 * consequential step the person approves first.
 */
export function registerAgentChatTaskTools(
  registry: RuntimeToolRegistry,
  parts: AgentChatTaskToolParts,
): void {
  if (parts.mode === "off") return;
  registry.register<z.infer<typeof LIST_SCHEMA>, PicaToolOutcome>({
    id: AGENT_TASK_LIST_TOOL,
    description: LIST_DESCRIPTION,
    inputSchema: LIST_SCHEMA,
    outputSchema: PICA_TOOL_OUTCOME,
    execute: (_, context) =>
      guarded(parts, context, async () => {
        const receipts = await parts.tasks.list();
        return toolkitResult({
          tasks: receipts.map((receipt) => ({
            taskId: receipt.task.id,
            kind: receipt.task.kind,
            request: receipt.task.request,
            instruction: receipt.task.instruction,
            when: receipt.when,
            isActive: receipt.task.isActive,
            nextRunAt: receipt.task.nextRunAt,
            requestedBy: receipt.task.requesterName,
          })),
        });
      }),
  });
  if (parts.mode === "full") registerWrites(registry, parts);
}
