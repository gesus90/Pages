import { isAgentParameterName } from "./AgentParameters";
import type { AgentParameter } from "./AgentParameters";
import type { AcpNamespaceOwner } from "./AcpResource";
import type {
  AgentPlanBinding,
  AgentPlanPosition,
  AgentPlanStepRole,
} from "./AgentPlan";
import type { AgentPlanExecutionTarget } from "./AgentPlanExecution";
import { planScriptReportSchema } from "./AgentPlanScriptReport";
import type {
  InterpreterCheck,
  InterpreterFailure,
} from "./InterpreterProfile";

/** The longest script name, as long as a group name. */
export const PLAN_SCRIPT_NAME_LENGTH = 120;
/** The longest script content in characters. */
export const PLAN_SCRIPT_CONTENT_LENGTH = 100_000;
/** The most inputs a script declares. */
export const PLAN_SCRIPT_INPUT_COUNT = 16;
/** The longest replacement output of a disabled script, in characters. */
export const PLAN_SCRIPT_DISABLED_OUTPUT_LENGTH = 100_000;

/** The passed report a disabled script returns when it declares a report or gate output. */
export const PLAN_SCRIPT_SKIPPED_REPORT = {
  status: "passed",
  summary: "Übersprungen (deaktiviert)",
  checks: [
    {
      name: "skipped",
      status: "passed",
      detail: "Übersprungen (deaktiviert)",
    },
  ],
} as const;
/** The allowed run time of a script, in whole seconds. */
export const PLAN_SCRIPT_TIMEOUT = {
  minimum: 1,
  maximum: 86_400,
  initial: 60,
} as const;

/** UTF-8 byte limits; exceeding a limit fails the step, never truncates a successful result. */
export const PLAN_SCRIPT_BYTES = {
  input: 1_048_576,
  stdout: 131_072,
  stderr: 131_072,
} as const;

/** Why the process ended, independently of any business meaning of its output. */
export type AgentPlanScriptFailure =
  | "spawn"
  | "exit"
  | "signal"
  | "timeout"
  | "cancelled"
  | "output_limit"
  | "encoding"
  | "credentials"
  | "io"
  | "cleanup"
  | "interrupted";

/** Process diagnostics within the existing node result; identifiers never authorize killing a PID. */
export interface AgentPlanScriptRun {
  readonly attemptId: string;
  readonly instanceId: string;
  readonly interpreterProfileId: string;
  readonly directory: string;
  readonly userId: string;
  readonly uid: number;
  readonly gid: number;
  readonly processId: number | null;
  /** Kernel identity of the directly spawned PID namespace supervisor. */
  readonly namespace?: AcpNamespaceOwner;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly failure: AgentPlanScriptFailure | null;
  readonly closeout: "pending" | "confirmed" | "failed";
  readonly stdout: string | null;
  readonly stderr: string;
}

/** One declared text input; a parameter, a ticket or a result fills it. */
export interface AgentPlanScriptInput {
  readonly name: string;
  readonly type: "text";
  readonly isRequired: boolean;
}

/** One declared text output; the script's result port delivers it. */
export interface AgentPlanScriptOutput {
  readonly name: string;
  readonly type: "text";
  /** An explicit structured review report, or a strict passing gate; absent keeps arbitrary text. */
  readonly policy?: "report" | "gate";
}

/**
 * A script step: its content runs with an interpreter profile in the
 * selected workspace, defaulting to the local workspace of the plan.
 *
 * @remarks
 * The profile is named by its stable identifier (PAGE-116), never by its
 * label, so a renamed profile stays the same and a removed one stays
 * visibly missing. Remote targets use runner-owned interpreter identities and
 * the durable remote dispatcher. A script has no model or reasoning.
 * An authorized explicit run sends one UTF-8 JSON object on stdin:
 * declared names map to text, optional unbound inputs are omitted, explicit
 * empty strings are retained. stdout stays exact text; stderr is diagnostic.
 * Runs require active administrator mode and live workspace and plan rights.
 * Timeout is always finite; the shared bounds apply to editor and runtime.
 */
export interface AgentPlanScript extends AgentPlanPosition {
  readonly id: string;
  readonly type: "script";
  readonly name: string;
  /** Only on a node of the flow itself; absent means an ordinary work step. */
  readonly role?: AgentPlanStepRole;
  readonly executionTarget?: AgentPlanExecutionTarget;
  readonly interpreterProfileId: string;
  readonly content: string;
  readonly inputs: readonly AgentPlanScriptInput[];
  /** Zero or one text output. Flow OUT is independent of the data result. */
  readonly outputs: readonly AgentPlanScriptOutput[];
  readonly timeoutSeconds: number;
  /** Absent means active; a disabled script is skipped without a process. */
  readonly disabled?: boolean;
  /** Replaces the result of a disabled script; empty means the policy default. */
  readonly disabledOutput?: string;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** The configuration of a script without its place and connections. */
export type AgentPlanScriptConfiguration = Pick<
  AgentPlanScript,
  | "name"
  | "executionTarget"
  | "interpreterProfileId"
  | "content"
  | "inputs"
  | "outputs"
  | "timeoutSeconds"
  | "disabled"
  | "disabledOutput"
>;

/** What is wrong with a script's own configuration. */
export type AgentPlanScriptIssue =
  | "name"
  | "profile"
  | "content"
  | "contentLength"
  | "inputCount"
  | "inputName"
  | "outputName"
  | "duplicateName"
  | "timeout"
  | "disabledOutput";

/**
 * An interpreter profile as the plan editor shows it: no program path.
 *
 * @remarks
 * `unchecked` is neutral: no check of the configured program has finished
 * since the server started or the path changed.
 */
export interface AgentPlanInterpreter {
  readonly remoteState?:
    "current" | "unreachable" | "stale" | "removed" | "incompatible";
  readonly runnerWorkspaceId?: string;
  readonly id: string;
  readonly name: string;
  readonly status: "ok" | "error" | "unchecked";
  readonly version: string | null;
  readonly error: InterpreterFailure | null;
}

function hasControlCharacters(text: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(text);
}

function nameIssues(
  configuration: AgentPlanScriptConfiguration,
): AgentPlanScriptIssue[] {
  const issues: AgentPlanScriptIssue[] = [];
  if (configuration.inputs.length > PLAN_SCRIPT_INPUT_COUNT)
    issues.push("inputCount");
  if (configuration.inputs.some((input) => !isAgentParameterName(input.name)))
    issues.push("inputName");
  if (
    configuration.outputs.length > 1 ||
    configuration.outputs.some((output) => !isAgentParameterName(output.name))
  )
    issues.push("outputName");
  const names = [...configuration.inputs, ...configuration.outputs].map(
    (entry) => entry.name,
  );
  if (new Set(names).size !== names.length) issues.push("duplicateName");
  return issues;
}

/**
 * Lists every problem of a script's own configuration.
 *
 * @remarks
 * The editor and the server use the same rules: a name, a profile, a
 * nonempty content within its length, valid and unique input and output
 * names and a timeout in whole seconds within its bounds. Whether the
 * profile exists is checked against the configured profiles separately.
 */
export function planScriptIssues(
  configuration: AgentPlanScriptConfiguration,
): readonly AgentPlanScriptIssue[] {
  const issues: AgentPlanScriptIssue[] = [];
  const name = configuration.name.trim();
  if (
    !name ||
    name.length > PLAN_SCRIPT_NAME_LENGTH ||
    hasControlCharacters(name)
  )
    issues.push("name");
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(configuration.interpreterProfileId))
    issues.push("profile");
  if (!configuration.content.trim()) issues.push("content");
  if (configuration.content.length > PLAN_SCRIPT_CONTENT_LENGTH)
    issues.push("contentLength");
  issues.push(...nameIssues(configuration));
  if (disabledOutputIssue(configuration)) issues.push("disabledOutput");
  const timeout = configuration.timeoutSeconds;
  if (
    !Number.isInteger(timeout) ||
    timeout < PLAN_SCRIPT_TIMEOUT.minimum ||
    timeout > PLAN_SCRIPT_TIMEOUT.maximum
  )
    issues.push("timeout");
  return issues;
}

/** The replacement output of a disabled script, before its report policy is assessed. */
export function planScriptDisabledOutput(
  script: Pick<AgentPlanScript, "outputs" | "disabledOutput">,
): string | null {
  const output = script.outputs[0];
  if (!output) return null;
  const replacement = script.disabledOutput ?? "";
  if (replacement.trim()) return replacement;
  if (output.policy) return JSON.stringify(PLAN_SCRIPT_SKIPPED_REPORT);
  return "";
}

/**
 * A replacement report may only claim a passed review, so a disabled gate never fails the run.
 *
 * @remarks
 * The length is bounded even while the script is active, so enabling it later
 * cannot keep an oversized value. The JSON shape is checked only while disabled,
 * because an enabled script never reads the replacement.
 */
function disabledOutputIssue(
  configuration: AgentPlanScriptConfiguration,
): boolean {
  const replacement = configuration.disabledOutput;
  if (replacement === undefined) return false;
  if (replacement.length > PLAN_SCRIPT_DISABLED_OUTPUT_LENGTH) return true;
  const policy = configuration.outputs[0]?.policy;
  if (!configuration.disabled || !policy || !replacement.trim()) return false;
  let value: unknown;
  try {
    value = JSON.parse(replacement);
  } catch {
    return true;
  }
  const parsed = planScriptReportSchema.safeParse(value);
  return !parsed.success || parsed.data.status !== "passed";
}

/**
 * The inputs of a script as the text parameters the plan graph binds.
 *
 * @remarks
 * A script input has no description and no default: an unbound required
 * input stays open until something fills it.
 */
export function planScriptParameters(
  script: Pick<AgentPlanScript, "inputs">,
): readonly AgentParameter[] {
  return script.inputs.map((input) => ({
    name: input.name,
    type: "text",
    description: "",
    isRequired: input.isRequired,
    defaultValue: null,
  }));
}

/**
 * The editor's view of the configured profiles and their last checks.
 *
 * @param profiles - The configured profiles in their order.
 * @param checks - The last check of each profile by its identifier.
 */
export function planInterpreters(
  profiles: readonly { readonly id: string; readonly name: string }[],
  checks: Readonly<Record<string, InterpreterCheck>>,
): readonly AgentPlanInterpreter[] {
  return profiles.map((profile) => {
    const check = checks[profile.id];
    return {
      id: profile.id,
      name: profile.name,
      status: check?.status ?? "unchecked",
      version: check?.version ?? null,
      error: check?.error ?? null,
    };
  });
}
