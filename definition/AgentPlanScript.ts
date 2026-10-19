import { isAgentParameterName } from "./AgentParameters";

import type { AgentParameter } from "./AgentParameters";
import type { AgentPlanBinding, AgentPlanPosition } from "./AgentPlan";
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
/** The allowed run time of a script, in whole seconds. */
export const PLAN_SCRIPT_TIMEOUT = {
  minimum: 1,
  maximum: 300,
  initial: 60,
} as const;

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
}

/**
 * A script step: its content runs with an interpreter profile in the
 * workspace of the plan.
 *
 * @remarks
 * The profile is named by its stable identifier (PAGE-116), never by its
 * label, so a renamed profile stays the same and a removed one stays
 * visibly missing. A script has no workspace, model or reasoning of its
 * own. Pages does not run scripts yet: a plan with a script node does not
 * start, see the `scriptUnavailable` issue of the plan graph.
 */
export interface AgentPlanScript extends AgentPlanPosition {
  readonly id: string;
  readonly type: "script";
  readonly name: string;
  readonly interpreterProfileId: string;
  readonly content: string;
  readonly inputs: readonly AgentPlanScriptInput[];
  /** Exactly one output for now: the result port carries one value. */
  readonly outputs: readonly AgentPlanScriptOutput[];
  readonly timeoutSeconds: number;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** The configuration of a script without its place and connections. */
export type AgentPlanScriptConfiguration = Pick<
  AgentPlanScript,
  | "name"
  | "interpreterProfileId"
  | "content"
  | "inputs"
  | "outputs"
  | "timeoutSeconds"
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
  | "timeout";

/**
 * An interpreter profile as the plan editor shows it: no program path.
 *
 * @remarks
 * `unchecked` is neutral: no check of the configured program has finished
 * since the server started or the path changed.
 */
export interface AgentPlanInterpreter {
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
    configuration.outputs.length !== 1 ||
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
  const timeout = configuration.timeoutSeconds;
  if (
    !Number.isInteger(timeout) ||
    timeout < PLAN_SCRIPT_TIMEOUT.minimum ||
    timeout > PLAN_SCRIPT_TIMEOUT.maximum
  )
    issues.push("timeout");
  return issues;
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
