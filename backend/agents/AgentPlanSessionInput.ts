import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";
import { readCompletionGate } from "./AgentPlanWorkInput";
import { readPlanProviderFailure, readPlanRetry } from "./AgentPlanRetryInput";
import {
  readPlanContinuationCapabilities,
  readPlanContentDigest,
} from "./AgentPlanRecoveryInput";

import type { AgentPlanActivity } from "@/definition/AgentPlanProgress";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type {
  AgentPlanAcceptance,
  AgentPlanContract,
  AgentPlanContractItem,
  AgentPlanGroupSessionLink,
  AgentPlanLoopSessionLink,
  AgentPlanProcessExit,
  AgentPlanRunner,
  AgentPlanRunnerConfiguration,
  AgentPlanSessionMode,
  AgentPlanSessionRecord,
} from "@/definition/AgentPlanSession";

const RUNNERS: readonly AgentPlanRunner[] = [
  "codex_cli",
  "claude_code",
  "opencode",
  "api",
];
const MODES: readonly AgentPlanSessionMode[] = [
  "one_shot",
  "interactive",
  "request",
];
const CLOSEOUTS = ["pending", "confirmed", "failed", "not_needed"] as const;
const MAXIMUM_TEXT = 4_000;

function invalid(): AgentError {
  return new AgentError("plan_invalid");
}

// Stored texts are short already; a longer one is cut, never a reason to lose the run.
function text(input: unknown, maximum = MAXIMUM_TEXT): string {
  if (typeof input !== "string") throw invalid();
  return input.slice(0, maximum);
}

function nullableText(input: unknown): string | null {
  return input === null || input === undefined ? null : text(input);
}

function nullableNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "number" || !Number.isFinite(input)) throw invalid();
  return input;
}

function texts(input: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(input) || input.length > maximum) throw invalid();
  return input.map((entry: unknown) => text(entry));
}

function oneOf<Value extends string>(
  input: unknown,
  values: readonly Value[],
): Value {
  const match = values.find((value) => value === input);
  if (match === undefined) throw invalid();
  return match;
}

function readOptions(input: unknown): AgentRunOptions | null {
  if (input === null || input === undefined) return null;
  const options = readAgentObject(input);
  if (typeof options.shell !== "boolean" || typeof options.web !== "boolean")
    throw invalid();
  return {
    access: oneOf(options.access, [
      "workspace_write",
      "read_only",
      "yolo",
    ] as const),
    shell: options.shell,
    web: options.web,
    timeoutMinutes: nullableNumber(options.timeoutMinutes) ?? 0,
    ...(options.browser === undefined
      ? {}
      : { browser: options.browser === true }),
  };
}

function readRequested(input: unknown): AgentPlanRunnerConfiguration {
  const requested = readAgentObject(input);
  if (typeof requested.mcp !== "boolean") throw invalid();
  return {
    runner: oneOf(requested.runner, RUNNERS),
    connectionId: text(requested.connectionId, 200),
    connectionName: text(requested.connectionName, 200),
    model: text(requested.model, 200),
    reasoningEffort: nullableText(requested.reasoningEffort),
    options: readOptions(requested.options),
    unattended: text(requested.unattended),
    mcp: requested.mcp,
    directory: nullableText(requested.directory),
  };
}

function readItem(input: unknown): AgentPlanContractItem {
  const item = readAgentObject(input);
  const ticket = item.ticket === null ? null : readAgentObject(item.ticket);
  return {
    id: text(item.id, 20),
    text: text(item.text),
    ticket:
      ticket === null
        ? null
        : {
            id: text(ticket.id, 200),
            key: text(ticket.key, 200),
            itemId: text(ticket.itemId, 200),
          },
  };
}

/** Parses a persisted contract without trusting unvalidated snapshot contents. */
export function readPlanContract(input: unknown): AgentPlanContract | null {
  if (input === null || input === undefined) return null;
  const contract = readAgentObject(input);
  if (
    !Array.isArray(contract.todos) ||
    !Array.isArray(contract.criteria) ||
    !Array.isArray(contract.tickets)
  )
    throw invalid();
  return {
    ...(contract.completion === "todos"
      ? { completion: "todos" as const }
      : {}),
    ...(contract.completionGate === undefined
      ? {}
      : { completionGate: readCompletionGate(contract.completionGate) }),
    todos: contract.todos.map(readItem),
    criteria: contract.criteria.map(readItem),
    tickets: contract.tickets.map((entry: unknown) => {
      const ticket = readAgentObject(entry);
      return {
        id: text(ticket.id, 200),
        key: text(ticket.key, 200),
        ...(ticket.requirementsHash === undefined
          ? {}
          : { requirementsHash: text(ticket.requirementsHash, 64) }),
      };
    }),
  };
}

function readAcceptance(input: unknown): AgentPlanAcceptance | null {
  if (input === null || input === undefined) return null;
  const acceptance = readAgentObject(input);
  if (!Array.isArray(acceptance.todos) || !Array.isArray(acceptance.criteria))
    throw invalid();
  return {
    verdict: oneOf(acceptance.verdict, [
      "accepted",
      "open",
      "rejected",
    ] as const),
    todos: acceptance.todos.map((entry: unknown) => {
      const todo = readAgentObject(entry);
      return {
        id: text(todo.id, 20),
        status: oneOf(todo.status, ["done", "open", "missing"] as const),
      };
    }),
    criteria: acceptance.criteria.map((entry: unknown) => {
      const criterion = readAgentObject(entry);
      const checked = criterion.ticketChecked;
      return {
        id: text(criterion.id, 20),
        met: criterion.met === true,
        evidence: text(criterion.evidence),
        ticketChecked: typeof checked === "boolean" ? checked : null,
      };
    }),
    decisions: texts(acceptance.decisions, 50),
    issues: texts(acceptance.issues, 500),
    summary: text(acceptance.summary),
  };
}

function readEffective(
  input: unknown,
): Readonly<Record<string, string>> | null {
  if (input === null || input === undefined) return null;
  return Object.fromEntries(
    Object.entries(readAgentObject(input)).map(([key, value]) => [
      text(key, 100),
      text(value),
    ]),
  );
}

function readExit(input: unknown): AgentPlanProcessExit | null {
  if (input === null || input === undefined) return null;
  const exit = readAgentObject(input);
  return {
    code: nullableNumber(exit.code),
    signal: nullableText(exit.signal),
  };
}

function readDefinition(input: unknown): AgentPlanSessionRecord["definition"] {
  if (input === null || input === undefined) return null;
  const definition = readAgentObject(input);
  return {
    path: text(definition.path),
    revision: nullableNumber(definition.revision) ?? 0,
  };
}

function readGroupLink(input: unknown): AgentPlanGroupSessionLink {
  const link = readAgentObject(input);
  const turn = nullableNumber(link.turn);
  if (turn === null || !Number.isSafeInteger(turn) || turn < 1) throw invalid();
  return {
    groupId: text(link.groupId, 100),
    adapter: oneOf(link.adapter, [
      "codex_cli",
      "claude_code",
      "opencode",
    ] as const),
    role: oneOf(link.role, ["created", "continued"] as const),
    creatorStepId: text(link.creatorStepId, 100),
    turn,
    acpSessionId: nullableText(link.acpSessionId),
    nativeSessionId: nullableText(link.nativeSessionId),
  };
}

function readLoopLink(input: unknown): AgentPlanLoopSessionLink {
  const link = readAgentObject(input);
  const turn = nullableNumber(link.turn);
  const iteration = nullableNumber(link.iteration);
  if (
    turn === null ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    iteration === null ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1
  )
    throw invalid();
  return {
    loopId: text(link.loopId, 100),
    iteration,
    policy: oneOf(link.policy, ["reuse", "fresh"] as const),
    role: oneOf(link.role, ["created", "continued", "fresh"] as const),
    turn,
    acpSessionId: nullableText(link.acpSessionId),
    nativeSessionId: nullableText(link.nativeSessionId),
  };
}

function readActivity(input: unknown): AgentPlanActivity {
  const activity = readAgentObject(input);
  if (!Array.isArray(activity.titles)) throw invalid();
  return {
    reportedAt: text(activity.reportedAt, 100),
    titles: activity.titles.map((title: unknown) => text(title)),
  };
}

function readRetryMetadata(
  record: Record<string, unknown>,
): Pick<AgentPlanSessionRecord, "providerFailure" | "retry"> {
  return {
    ...(record.providerFailure === undefined
      ? {}
      : { providerFailure: readPlanProviderFailure(record.providerFailure) }),
    ...(record.retry === undefined
      ? {}
      : { retry: readPlanRetry(record.retry) }),
  };
}

/**
 * Narrows the persisted record of an agent node; older runs have none.
 *
 * @param input - The stored value of the step.
 * @returns The record, or `null` when the step has none.
 * @throws {AgentError} `plan_invalid` for a malformed record.
 */
export function readPlanSessionRecord(
  input: unknown,
): AgentPlanSessionRecord | null {
  if (input === null || input === undefined) return null;
  const record = readAgentObject(input);
  const resultCode = record.resultCode;
  if (resultCode !== 0 && resultCode !== -1 && resultCode !== null)
    throw invalid();
  return {
    runner: oneOf(record.runner, RUNNERS),
    ...readRetryMetadata(record),
    mode: oneOf(record.mode, MODES),
    instanceId: text(record.instanceId, 100),
    ...(typeof record.attemptId === "string"
      ? { attemptId: text(record.attemptId, 100) }
      : {}),
    ...(record.dispatchedPromptDigest === undefined
      ? {}
      : {
          dispatchedPromptDigest: readPlanContentDigest(
            record.dispatchedPromptDigest,
          ),
        }),
    ...(record.continuationCapabilities === undefined
      ? {}
      : {
          continuationCapabilities: readPlanContinuationCapabilities(
            record.continuationCapabilities,
          ),
        }),
    sessionId: nullableText(record.sessionId),
    processId: nullableNumber(record.processId),
    startedAt: nullableText(record.startedAt),
    turnEndedAt: nullableText(record.turnEndedAt),
    endedAt: nullableText(record.endedAt),
    exit: readExit(record.exit),
    closeout: oneOf(record.closeout, CLOSEOUTS),
    leftoverProcesses: nullableNumber(record.leftoverProcesses),
    resultCode,
    requested: readRequested(record.requested),
    effective: readEffective(record.effective),
    definition: readDefinition(record.definition),
    contract: readPlanContract(record.contract),
    acceptance: readAcceptance(record.acceptance),
    events: texts(record.events, 100),
    ...(record.activity === undefined
      ? {}
      : { activity: readActivity(record.activity) }),
    ...(record.group === undefined || record.group === null
      ? {}
      : { group: readGroupLink(record.group) }),
    ...(record.loop === undefined || record.loop === null
      ? {}
      : { loop: readLoopLink(record.loop) }),
  };
}
