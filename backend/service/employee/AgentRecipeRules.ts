import { z } from "zod";

import {
  AGENT_RECIPE_BODY_CHARACTERS,
  AGENT_RECIPE_NAME_CHARACTERS,
  AGENT_RECIPE_PARAMETER_LIMIT,
  AGENT_RECIPE_STEP_LIMIT,
  AGENT_RECIPE_SUMMARY_CHARACTERS,
} from "@/definition/AgentDreaming";

import { stripCredentials } from "./AgentEmployeeText";

import type { AgentRecipeContent } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import type { AgentRecipeKind } from "@/definition/AgentDreaming";

/** The name of the tool that runs a flow recipe; a recipe never calls it. */
export const RECIPE_TOOL = "rezept";

/** How a tool stands to a recipe. */
export type RecipeToolClass = "ok" | "confirmation" | "unusable";

/** Characters of the note of a step. */
const NOTE_CHARACTERS = 120;
/** Characters of the evidence of a recipe. */
const EVIDENCE_CHARACTERS = 200;
/** Keywords of a recipe at most. */
const KEYWORD_LIMIT = 8;
/** Characters of a keyword. */
const KEYWORD_CHARACTERS = 30;
/** Characters of the description of a parameter. */
const PARAMETER_DESCRIPTION_CHARACTERS = 200;

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,29}$/u;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,100}$/u;
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/gu;
const STEP_REFERENCE = /^(\d+)(?:\.(.+))?$/u;

/**
 * Tools that delete, remove or archive: whole words of the tool name, so
 * `agents_delete` and `storage_delete_permanently` count, `agents_deleted_list`
 * does not. A recipe never runs them on its own.
 */
const CONFIRMATION_TOOL =
  /(?:^|_)(?:delete|trash|remove|archive|purge|permanently|revoke)(?:_|$)/u;
/** Input fields that carry a confirmation; a recipe never supplies one. */
const CONFIRMATION_FIELD =
  /^(?:confirm|confirmed|confirmation|confirmrepeat)$/iu;

const GERMAN_LETTERS: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/**
 * The name of a recipe in the form `rezept(name, …)` is called with: lower
 * case, words joined by `-`, umlauts spelled out.
 *
 * @param raw - The name as somebody wrote it.
 * @returns The name, or `null` when nothing usable is left.
 */
export function recipeName(raw: string): string | null {
  const name = raw
    .trim()
    .toLocaleLowerCase("de")
    .replace(/[äöüß]/gu, (letter) => GERMAN_LETTERS[letter] ?? letter)
    .replace(/[^a-z0-9_]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, AGENT_RECIPE_NAME_CHARACTERS)
    .replace(/-+$/u, "");
  return name.length >= 2 && NAME_PATTERN.test(name) ? name : null;
}

/**
 * How a tool stands to a recipe: usable, one that needs the normal
 * confirmation and so is never run by a recipe (deleting, removing,
 * archiving), or one a recipe cannot call at all (itself, a name that is no tool).
 *
 * @param tool - The name of the tool.
 */
export function classifyRecipeTool(tool: string): RecipeToolClass {
  if (tool === RECIPE_TOOL || !TOOL_NAME.test(tool)) return "unusable";
  return CONFIRMATION_TOOL.test(tool) ? "confirmation" : "ok";
}

/** Whether the input of a step names a confirmation, which only the person may give. */
export function carriesConfirmation(
  input: Readonly<Record<string, unknown>>,
): boolean {
  return Object.keys(input).some((key) => CONFIRMATION_FIELD.test(key));
}

/** The placeholders `{{…}}` a text names, without the braces. */
function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/** Every placeholder inside an input, whatever its depth. */
function inputPlaceholders(value: unknown): string[] {
  if (typeof value === "string") return placeholdersOf(value);
  if (Array.isArray(value)) return value.flatMap(inputPlaceholders);
  if (typeof value === "object" && value !== null)
    return Object.values(value).flatMap(inputPlaceholders);
  return [];
}

/** The text with its credentials masked, collapsed to one line and cut. */
function line(text: string, maximum: number): string {
  const single = stripCredentials(text).replace(/\s+/gu, " ").trim();
  return Array.from(single).slice(0, maximum).join("");
}

/** A recipe as the dream run or an editor proposes it, before Pages checks it. */
export interface AgentRecipeDraft {
  readonly name: string;
  readonly kind: AgentRecipeKind;
  readonly summary: string;
  readonly keywords?: readonly string[] | undefined;
  readonly parameters?:
    | readonly { readonly name: string; readonly description: string }[]
    | undefined;
  readonly steps?:
    | readonly {
        readonly tool: string;
        readonly input: Readonly<Record<string, unknown>>;
        readonly note?: string | undefined;
      }[]
    | undefined;
  readonly body?: string | undefined;
  readonly evidence?: string | undefined;
}

/** What checking a draft found. */
export type AgentRecipeCheck =
  | { readonly isValid: true; readonly content: AgentRecipeContent }
  | { readonly isValid: false; readonly reason: string };

/** What checking needs besides the draft. */
export interface AgentRecipeCheckContext {
  /** `YYYY-MM-DD` the recipe is confirmed on. */
  readonly today: string;
  /** The strength the recipe gets. */
  readonly strength: number;
  /** The tools a flow recipe may name; `null` accepts any usable tool. */
  readonly knownTools: ReadonlySet<string> | null;
}

function invalid(reason: string): AgentRecipeCheck {
  return { isValid: false, reason };
}

/** The checked parameters of a draft, or the reason one is not usable. */
function checkParameters(draft: AgentRecipeDraft):
  | {
      readonly names: Set<string>;
      readonly list: AgentRecipeContent["parameters"];
    }
  | string {
  const parameters = (draft.parameters ?? []).map((parameter) => ({
    name: parameter.name.trim(),
    description: line(parameter.description, PARAMETER_DESCRIPTION_CHARACTERS),
  }));
  if (parameters.length > AGENT_RECIPE_PARAMETER_LIMIT)
    return "tooManyParameters";
  const names = new Set(parameters.map((parameter) => parameter.name));
  if (
    names.size !== parameters.length ||
    parameters.some((parameter) => !PARAMETER_NAME.test(parameter.name))
  )
    return "parameterName";
  return { names, list: parameters };
}

/** Whether a placeholder names a declared parameter or the result of an earlier step. */
function isKnownPlaceholder(
  placeholder: string,
  scope: { readonly names: ReadonlySet<string>; readonly stepNumber: number },
): boolean {
  if (scope.names.has(placeholder)) return true;
  const reference = STEP_REFERENCE.exec(placeholder);
  if (!reference) return false;
  const earlier = Number(reference[1]);
  return earlier >= 1 && earlier < scope.stepNumber;
}

/** The checked steps of a flow draft, or the reason one is not usable. */
function checkSteps(
  draft: AgentRecipeDraft,
  context: AgentRecipeCheckContext,
  names: ReadonlySet<string>,
): AgentRecipeContent["steps"] | string {
  const steps = draft.steps ?? [];
  if (steps.length === 0) return "noSteps";
  if (steps.length > AGENT_RECIPE_STEP_LIMIT) return "tooManySteps";
  const checked: AgentRecipeContent["steps"][number][] = [];
  for (const [index, step] of steps.entries()) {
    const tool = step.tool.trim();
    if (classifyRecipeTool(tool) !== "ok") return "stepTool";
    if (context.knownTools !== null && !context.knownTools.has(tool))
      return "unknownTool";
    if (carriesConfirmation(step.input)) return "stepConfirmation";
    const scope = { names, stepNumber: index + 1 };
    if (
      !inputPlaceholders(step.input).every((placeholder) =>
        isKnownPlaceholder(placeholder, scope),
      )
    )
      return "placeholder";
    checked.push({
      tool,
      input: step.input,
      note: line(step.note ?? "", NOTE_CHARACTERS),
    });
  }
  return checked;
}

/**
 * Checks a recipe before it is stored.
 *
 * @remarks
 * A flow recipe needs one to eight steps. Each names a tool a recipe may
 * call (never a deleting, removing or archiving one, never an input with a
 * confirmation, never the recipe tool itself) and uses placeholders only for
 * its own parameters or the result of an earlier step. A knowledge recipe
 * needs a guide. Texts are cut and carry no credentials.
 *
 * @param draft - The recipe as proposed.
 * @param context - The date, the strength and the tools the agent is known to use.
 */
export function checkRecipeDraft(
  draft: AgentRecipeDraft,
  context: AgentRecipeCheckContext,
): AgentRecipeCheck {
  const name = recipeName(draft.name);
  if (name === null) return invalid("name");
  const summary = line(draft.summary, AGENT_RECIPE_SUMMARY_CHARACTERS);
  if (summary === "") return invalid("summary");
  const keywords = [
    ...new Set(
      (draft.keywords ?? [])
        .map((keyword) => line(keyword, KEYWORD_CHARACTERS).toLocaleLowerCase())
        .filter((keyword) => keyword !== ""),
    ),
  ].slice(0, KEYWORD_LIMIT);
  const common = {
    name,
    summary,
    keywords,
    evidence: line(draft.evidence ?? "", EVIDENCE_CHARACTERS),
    confirmedOn: context.today,
    strength: context.strength,
  };
  if (draft.kind === "knowledge") {
    const body = stripCredentials(draft.body ?? "").trim();
    if (body === "") return invalid("body");
    return {
      isValid: true,
      content: {
        ...common,
        kind: "knowledge",
        parameters: [],
        steps: [],
        body: Array.from(body).slice(0, AGENT_RECIPE_BODY_CHARACTERS).join(""),
      },
    };
  }
  const parameters = checkParameters(draft);
  if (typeof parameters === "string") return invalid(parameters);
  const steps = checkSteps(draft, context, parameters.names);
  if (typeof steps === "string") return invalid(steps);
  return {
    isValid: true,
    content: {
      ...common,
      kind: "flow",
      parameters: parameters.list,
      steps,
      body: "",
    },
  };
}

/** A value a placeholder cannot be filled with. */
export class RecipeValueError extends Error {
  public readonly placeholder: string;

  public constructor(placeholder: string) {
    super(`No value for {{${placeholder}}}`);
    this.name = "RecipeValueError";
    this.placeholder = placeholder;
  }
}

/** What the placeholders of a step are filled from. */
export interface RecipeValues {
  /** The parameters the caller gave. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** The parsed results of the steps so far; step 1 is at index 0. */
  readonly results: readonly unknown[];
}

/** The value at a dotted path of a parsed result; a number indexes an array. */
function valueAtPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (typeof current === "object" && current !== null)
      current = Reflect.get(current, segment);
    else return undefined;
  }
  return current;
}

function valueOf(placeholder: string, values: RecipeValues): unknown {
  if (Object.hasOwn(values.parameters, placeholder))
    return values.parameters[placeholder];
  const reference = STEP_REFERENCE.exec(placeholder);
  if (!reference) return undefined;
  const result = values.results[Number(reference[1]) - 1];
  const path = reference[2];
  return path === undefined ? result : valueAtPath(result, path);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Fills the placeholders of a step input. A text that is one placeholder keeps
 * the type of its value; inside a longer text the value is written out.
 *
 * @param template - The input of a step.
 * @param values - The parameters of the call and the results so far.
 * @throws {RecipeValueError} For a placeholder without a value.
 */
export function fillPlaceholders(
  template: unknown,
  values: RecipeValues,
): unknown {
  if (typeof template === "string") {
    const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/u.exec(template);
    if (whole?.[1] !== undefined) {
      const value = valueOf(whole[1], values);
      if (value === undefined) throw new RecipeValueError(whole[1]);
      return value;
    }
    return template.replace(PLACEHOLDER, (match, placeholder: string) => {
      const value = valueOf(placeholder, values);
      if (value === undefined) throw new RecipeValueError(placeholder);
      return textOf(value);
    });
  }
  if (Array.isArray(template))
    return template.map((entry: unknown) => fillPlaceholders(entry, values));
  if (typeof template === "object" && template !== null)
    return Object.fromEntries(
      Object.entries(template).map(([key, entry]) => [
        key,
        fillPlaceholders(entry, values),
      ]),
    );
  return template;
}

/** The input a model gives `rezept`: the name of a recipe and its parameters. */
export const RECIPE_INPUT_SCHEMA = z
  .object({
    name: z.string().trim().max(100).optional(),
    parameter: z
      .record(
        z.string().max(60),
        z.union([z.string().max(4_000), z.number(), z.boolean(), z.null()]),
      )
      .optional(),
  })
  .strict();

/** What `rezept` is called with. */
export type RecipeInput = z.infer<typeof RECIPE_INPUT_SCHEMA>;
