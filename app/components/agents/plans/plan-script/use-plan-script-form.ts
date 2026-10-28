import { useState } from "react";

import { createRandomUuid } from "@/app/lib/random-uuid";
import { effectivePlanTarget } from "@/definition/AgentPlanTarget";
import { isAgentParameterName } from "@/definition/AgentParameters";
import {
  PLAN_SCRIPT_INPUT_COUNT,
  PLAN_SCRIPT_TIMEOUT,
  planScriptIssues,
} from "@/definition/AgentPlanScript";

import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type {
  AgentPlanInterpreter,
  AgentPlanScript,
  AgentPlanScriptConfiguration,
} from "@/definition/AgentPlanScript";

/** One declared input while it is edited. */
export interface PlanScriptInputRow {
  /** Identifies the row while its name changes. */
  readonly key: string;
  readonly name: string;
  readonly isRequired: boolean;
  /** The name when the dialog opened; its connection follows a rename. */
  readonly original: string | null;
}

/** The fields of the script dialog, as typed. */
export interface PlanScriptFormValues {
  readonly name: string;
  /** The script's own target; absent, it runs where the plan says. */
  readonly executionTarget: AgentPlanExecutionTarget | undefined;
  readonly interpreterProfileId: string;
  readonly content: string;
  readonly inputs: readonly PlanScriptInputRow[];
  readonly output: string;
  readonly outputPolicy: "text" | "report" | "gate";
  readonly timeout: string;
}

/** What keeps a field from being applied. */
export type PlanScriptFieldIssue =
  | "name"
  | "profile"
  | "profileMissing"
  | "content"
  | "contentLength"
  | "timeout"
  | "inputName"
  | "outputName"
  | "duplicateName";

/** The problems of the typed fields, by field and by input row. */
export interface PlanScriptFormIssues {
  readonly fields: ReadonlySet<PlanScriptFieldIssue>;
  readonly rows: ReadonlyMap<string, PlanScriptFieldIssue>;
  readonly output: PlanScriptFieldIssue | null;
}

/** The script dialog's state, its checks and the result it applies. */
export interface PlanScriptForm {
  readonly values: PlanScriptFormValues;
  /** The plan's target, which the script inherits without one of its own. */
  readonly planTarget: AgentPlanExecutionTarget | undefined;
  /** Where the script runs with the typed values. */
  readonly effectiveTarget: AgentPlanExecutionTarget;
  readonly issues: PlanScriptFormIssues;
  /** Problems show once a field changed or applying was tried. */
  readonly isShown: (field: keyof PlanScriptFormValues) => boolean;
  /** The problem of an input row shows once its name changed or applying was tried. */
  readonly isRowShown: (key: string) => boolean;
  /** The saved profile the server no longer configures, kept until changed. */
  readonly isProfileWithdrawn: boolean;
  readonly change: (patch: Partial<PlanScriptFormValues>) => void;
  readonly changeInput: (
    key: string,
    patch: Partial<Omit<PlanScriptInputRow, "key" | "original">>,
  ) => void;
  readonly addInput: () => void;
  readonly removeInput: (key: string) => void;
  /** The checked configuration and connections, or `null` with every problem shown. */
  readonly submit: () => {
    readonly configuration: AgentPlanScriptConfiguration;
    readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
  } | null;
}

function initialValues(
  script: AgentPlanScript | null,
  output: string,
): PlanScriptFormValues {
  if (!script)
    return {
      name: "",
      executionTarget: undefined,
      interpreterProfileId: "",
      content: "",
      inputs: [],
      output,
      outputPolicy: "text",
      timeout: String(PLAN_SCRIPT_TIMEOUT.initial),
    };
  return {
    name: script.name,
    executionTarget: script.executionTarget,
    interpreterProfileId: script.interpreterProfileId,
    content: script.content,
    inputs: script.inputs.map((input) => ({
      key: createRandomUuid(),
      name: input.name,
      isRequired: input.isRequired,
      original: input.name,
    })),
    output: script.outputs[0]?.name ?? "",
    outputPolicy: script.outputs[0]?.policy ?? "text",
    timeout: String(script.timeoutSeconds),
  };
}

function configurationOf(
  values: PlanScriptFormValues,
): AgentPlanScriptConfiguration {
  return {
    name: values.name.trim(),
    executionTarget: values.executionTarget,
    interpreterProfileId: values.interpreterProfileId,
    content: values.content,
    inputs: values.inputs.map((input) => ({
      name: input.name.trim(),
      type: "text",
      isRequired: input.isRequired,
    })),
    outputs: values.output.trim()
      ? [
          {
            name: values.output.trim(),
            type: "text",
            ...(values.outputPolicy === "text"
              ? {}
              : { policy: values.outputPolicy }),
          },
        ]
      : [],
    timeoutSeconds: /^\d+$/u.test(values.timeout.trim())
      ? Number(values.timeout.trim())
      : Number.NaN,
  };
}

/** A name's own problem first, then a repeat of another declared name. */
function nameIssue(
  name: string,
  names: readonly string[],
): PlanScriptFieldIssue | null {
  if (!isAgentParameterName(name)) return "inputName";
  return names.filter((entry) => entry === name).length > 1
    ? "duplicateName"
    : null;
}

function formIssues(
  values: PlanScriptFormValues,
  context: {
    readonly interpreters: readonly AgentPlanInterpreter[] | undefined;
    readonly savedProfileId: string | null;
  },
): PlanScriptFormIssues {
  const configuration = configurationOf(values);
  const fields = new Set<PlanScriptFieldIssue>(
    planScriptIssues(configuration).filter(
      (issue) =>
        issue === "name" ||
        issue === "content" ||
        issue === "contentLength" ||
        issue === "timeout",
    ),
  );
  const profileId = values.interpreterProfileId;
  if (!profileId) fields.add("profile");
  else if (
    context.interpreters &&
    !context.interpreters.some((profile) => profile.id === profileId) &&
    profileId !== context.savedProfileId
  )
    fields.add("profileMissing");
  const names = [
    ...configuration.inputs.map((input) => input.name),
    ...configuration.outputs.map((output) => output.name),
  ];
  const rows = new Map<string, PlanScriptFieldIssue>();
  values.inputs.forEach((row) => {
    const issue = nameIssue(row.name.trim(), names);
    if (issue) rows.set(row.key, issue);
  });
  const output = values.output.trim()
    ? nameIssue(values.output.trim(), names)
    : null;
  return {
    fields,
    rows,
    output: output === "inputName" ? "outputName" : output,
  };
}

function hasIssues(issues: PlanScriptFormIssues): boolean {
  return (
    issues.fields.size > 0 || issues.rows.size > 0 || issues.output !== null
  );
}

/** The connections of the inputs that remain, following renamed inputs. */
function keptBindings(
  script: AgentPlanScript | null,
  inputs: readonly PlanScriptInputRow[],
): Readonly<Record<string, AgentPlanBinding>> {
  if (!script) return {};
  const bindings: Record<string, AgentPlanBinding> = {};
  for (const input of inputs) {
    const binding =
      input.original === null ? undefined : script.bindings[input.original];
    if (binding) bindings[input.name.trim()] = binding;
  }
  return bindings;
}

/**
 * Edits a new or existing script in a local copy and applies it only when it is valid.
 *
 * @param script - The script to edit, or `null` for a new one.
 * @param context - The configured profiles, the default output name and the
 * plan's target.
 */
export function usePlanScriptForm(
  script: AgentPlanScript | null,
  context: {
    readonly interpreters: readonly AgentPlanInterpreter[] | undefined;
    readonly defaultOutput: string;
    readonly planTarget?: AgentPlanExecutionTarget;
  },
): PlanScriptForm {
  const [values, setValues] = useState(() =>
    initialValues(script, context.defaultOutput),
  );
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [isAttempted, setIsAttempted] = useState(false);
  const savedProfileId = script?.interpreterProfileId ?? null;
  const issues = formIssues(values, {
    interpreters: context.interpreters,
    savedProfileId,
  });
  function touch(fields: readonly string[]): void {
    setTouched((previous) => new Set([...previous, ...fields]));
  }
  function change(patch: Partial<PlanScriptFormValues>): void {
    setValues((previous) => ({ ...previous, ...patch }));
    touch(Object.keys(patch));
  }
  function changeInput(
    key: string,
    patch: Partial<Omit<PlanScriptInputRow, "key" | "original">>,
  ): void {
    setValues((previous) => ({
      ...previous,
      inputs: previous.inputs.map((input) =>
        input.key === key ? { ...input, ...patch } : input,
      ),
    }));
    if (patch.name !== undefined) touch([`input:${key}`]);
  }
  // A new row starts empty; its name is checked once it was typed.
  function addInput(): void {
    if (values.inputs.length >= PLAN_SCRIPT_INPUT_COUNT) return;
    setValues((previous) => ({
      ...previous,
      inputs: [
        ...previous.inputs,
        { key: createRandomUuid(), name: "", isRequired: true, original: null },
      ],
    }));
  }
  function submit(): ReturnType<PlanScriptForm["submit"]> {
    setIsAttempted(true);
    if (hasIssues(issues)) return null;
    return {
      configuration: configurationOf(values),
      bindings: keptBindings(script, values.inputs),
    };
  }
  return {
    values,
    planTarget: context.planTarget,
    effectiveTarget: effectivePlanTarget(
      { executionTarget: values.executionTarget },
      { executionTarget: context.planTarget },
    ),
    issues,
    isShown: (field) => isAttempted || touched.has(field),
    isRowShown: (key) => isAttempted || touched.has(`input:${key}`),
    isProfileWithdrawn:
      savedProfileId !== null &&
      values.interpreterProfileId === savedProfileId &&
      context.interpreters !== undefined &&
      !context.interpreters.some((profile) => profile.id === savedProfileId),
    change,
    changeInput,
    addInput,
    removeInput: (key) =>
      change({ inputs: values.inputs.filter((input) => input.key !== key) }),
    submit,
  };
}
