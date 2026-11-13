import { z } from "zod";

import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AGENT_RECIPE_KINDS } from "@/definition/AgentDreaming";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentRecipeDisabledReason,
  AgentRecipeKind,
  AgentRecipeOrigin,
  AgentRecipeParameter,
  AgentRecipeStep,
} from "@/definition/AgentDreaming";

/** One recipe of an agent as it is stored (PAGE-378). */
export interface StoredAgentRecipe {
  readonly id: string;
  readonly agentId: string;
  readonly name: string;
  readonly kind: AgentRecipeKind;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly parameters: readonly AgentRecipeParameter[];
  readonly steps: readonly AgentRecipeStep[];
  readonly body: string;
  readonly evidence: string;
  /** `YYYY-MM-DD` of the newest confirmation. */
  readonly confirmedOn: string;
  readonly strength: number;
  readonly useCount: number;
  /** ISO time of the last use. */
  readonly lastUsedAt: string | null;
  readonly isActive: boolean;
  readonly disabledReason: AgentRecipeDisabledReason | null;
  readonly failureStreak: number;
  readonly lastError: string | null;
  readonly origin: AgentRecipeOrigin;
  /** `YYYY-MM-DD HH:MM:SS` UTC the recipe was created. */
  readonly createdAt: string;
}

/** The fields a recipe is written with; the counters of its use are not among them. */
export type AgentRecipeContent = Pick<
  StoredAgentRecipe,
  | "name"
  | "kind"
  | "summary"
  | "keywords"
  | "parameters"
  | "steps"
  | "body"
  | "evidence"
  | "confirmedOn"
  | "strength"
>;

/** A recipe about to be stored. */
export interface NewAgentRecipe extends AgentRecipeContent {
  readonly id: string;
  readonly agentId: string;
  readonly origin: AgentRecipeOrigin;
}

/** What a failed call did to the recipe. */
export interface AgentRecipeFailureOutcome {
  readonly failureStreak: number;
  /** The recipe is off now. */
  readonly isActive: boolean;
}

const COLUMNS = `
    id,
    agent_id,
    name,
    kind,
    summary,
    keywords,
    parameters,
    steps,
    body,
    evidence,
    confirmed_on,
    strength,
    use_count,
    last_used_at,
    is_active,
    disabled_reason,
    failure_streak,
    last_error,
    origin,
    created_at`;

const parameterSchema = z.array(
  z.object({ name: z.string(), description: z.string() }),
);
const stepSchema = z.array(
  z.object({
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    note: z.string(),
  }),
);
const keywordSchema = z.array(z.string());

/** Reads a JSON column; anything unreadable counts as the fallback. */
function readJson<Value>(
  text: string,
  schema: z.ZodType<Value>,
  fallback: Value,
): Value {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : fallback;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

function readKind(text: string): AgentRecipeKind {
  return AGENT_RECIPE_KINDS.find((kind) => kind === text) ?? "knowledge";
}

function readReason(text: string | null): AgentRecipeDisabledReason | null {
  if (text === "failed" || text === "manual") return text;
  return null;
}

function readOrigin(text: string): AgentRecipeOrigin {
  return text === "manual" ? "manual" : "dream";
}

function read(row: readonly DatabaseValue[]): StoredAgentRecipe {
  return {
    id: readTextColumn(row, 0, "id"),
    agentId: readTextColumn(row, 1, "agent_id"),
    name: readTextColumn(row, 2, "name"),
    kind: readKind(readTextColumn(row, 3, "kind")),
    summary: readTextColumn(row, 4, "summary"),
    keywords: readJson(readTextColumn(row, 5, "keywords"), keywordSchema, []),
    parameters: readJson(
      readTextColumn(row, 6, "parameters"),
      parameterSchema,
      [],
    ),
    steps: readJson(readTextColumn(row, 7, "steps"), stepSchema, []),
    body: readTextColumn(row, 8, "body"),
    evidence: readTextColumn(row, 9, "evidence"),
    confirmedOn: readTextColumn(row, 10, "confirmed_on"),
    strength: readCountColumn(row, 11, "strength"),
    useCount: readCountColumn(row, 12, "use_count"),
    lastUsedAt: readNullableTextColumn(row, 13, "last_used_at"),
    isActive: readBooleanColumn(row, 14, "is_active"),
    disabledReason: readReason(
      readNullableTextColumn(row, 15, "disabled_reason"),
    ),
    failureStreak: readCountColumn(row, 16, "failure_streak"),
    lastError: readNullableTextColumn(row, 17, "last_error"),
    origin: readOrigin(readTextColumn(row, 18, "origin")),
    createdAt: readTextColumn(row, 19, "created_at"),
  };
}

function contentParameters(
  content: AgentRecipeContent,
): Record<string, DatabaseValue> {
  return {
    name: content.name,
    kind: content.kind,
    summary: content.summary,
    keywords: JSON.stringify(content.keywords),
    parameters: JSON.stringify(content.parameters),
    steps: JSON.stringify(content.steps),
    body: content.body,
    evidence: content.evidence,
    confirmed_on: content.confirmedOn,
    strength: content.strength,
  };
}

/**
 * The recipes of agents (PAGE-378): flow recipes the tool `rezept` runs and
 * knowledge recipes that are loaded when they fit the topic of a chat.
 *
 * @remarks
 * Every statement names the agent, so a call never reaches the recipe of
 * another one. The counters of use and failure change in single statements.
 */
export class AgentRecipeRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** All recipes of an agent, the strongest first. */
  public async list(agentId: string): Promise<StoredAgentRecipe[]> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_recipes
        WHERE agent_id = $agent_id
        ORDER BY strength DESC, use_count DESC, name;
      `,
      { agent_id: agentId },
    );
    return rows.map(read);
  }

  /** The recipes that are on. */
  public async active(agentId: string): Promise<StoredAgentRecipe[]> {
    return (await this.list(agentId)).filter((recipe) => recipe.isActive);
  }

  /** A recipe by its name; `null` when the agent has none of that name. */
  public async findByName(
    agentId: string,
    name: string,
  ): Promise<StoredAgentRecipe | null> {
    const [row] = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_recipes
        WHERE agent_id = $agent_id
            AND name = $name;
      `,
      { agent_id: agentId, name },
    );
    return row ? read(row) : null;
  }

  /** A recipe by its ID; `null` when the agent has none with it. */
  public async findById(
    agentId: string,
    id: string,
  ): Promise<StoredAgentRecipe | null> {
    const [row] = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_recipes
        WHERE agent_id = $agent_id
            AND id = $id;
      `,
      { agent_id: agentId, id },
    );
    return row ? read(row) : null;
  }

  /** Stores a new recipe. */
  public async insert(recipe: NewAgentRecipe): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_recipes (
            id,
            agent_id,
            name,
            kind,
            summary,
            keywords,
            parameters,
            steps,
            body,
            evidence,
            confirmed_on,
            strength,
            origin
        )
        VALUES (
            $id,
            $agent_id,
            $name,
            $kind,
            $summary,
            $keywords,
            $parameters,
            $steps,
            $body,
            $evidence,
            $confirmed_on,
            $strength,
            $origin
        );
      `,
      {
        id: recipe.id,
        agent_id: recipe.agentId,
        origin: recipe.origin,
        ...contentParameters(recipe),
      },
    );
  }

  /**
   * Replaces the content of a recipe and, with `reactivate`, switches it on
   * again, which resets its failures; a recipe somebody switched off by hand
   * stays off.
   *
   * @returns Whether the recipe exists.
   */
  public async update(
    agentId: string,
    id: string,
    content: AgentRecipeContent,
    options: { readonly reactivate: boolean },
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_recipes
        SET
            name = $name,
            kind = $kind,
            summary = $summary,
            keywords = $keywords,
            parameters = $parameters,
            steps = $steps,
            body = $body,
            evidence = $evidence,
            confirmed_on = $confirmed_on,
            strength = $strength,
            is_active = CASE
                WHEN $reactivate AND disabled_reason = 'failed' THEN TRUE
                ELSE is_active
            END,
            disabled_reason = CASE
                WHEN $reactivate AND disabled_reason = 'failed' THEN NULL
                ELSE disabled_reason
            END,
            failure_streak = CASE WHEN $reactivate THEN 0 ELSE failure_streak END,
            last_error = CASE WHEN $reactivate THEN NULL ELSE last_error END
        WHERE agent_id = $agent_id
            AND id = $id
        RETURNING id;
      `,
      {
        agent_id: agentId,
        id,
        reactivate: options.reactivate,
        ...contentParameters(content),
      },
    );
    return rows.length > 0;
  }

  /**
   * Switches a recipe on or off by hand; switching it on resets its failures.
   *
   * @returns Whether the recipe exists.
   */
  public async setActive(
    agentId: string,
    id: string,
    isActive: boolean,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_recipes
        SET
            is_active = $is_active,
            disabled_reason = CASE WHEN $is_active THEN NULL ELSE 'manual' END,
            failure_streak = CASE WHEN $is_active THEN 0 ELSE failure_streak END,
            last_error = CASE WHEN $is_active THEN NULL ELSE last_error END
        WHERE agent_id = $agent_id
            AND id = $id
        RETURNING id;
      `,
      { agent_id: agentId, id, is_active: isActive },
    );
    return rows.length > 0;
  }

  /** Counts a successful call: one more use, the failures start again. */
  public async recordUse(
    agentId: string,
    id: string,
    at: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_recipes
        SET
            use_count = use_count + 1,
            last_used_at = $at,
            failure_streak = 0,
            last_error = NULL
        WHERE agent_id = $agent_id
            AND id = $id;
      `,
      { agent_id: agentId, id, at },
    );
  }

  /**
   * Counts a failed call and switches the recipe off once `limit` calls in a
   * row failed.
   *
   * @returns The failures in a row now and whether the recipe is on; `null`
   * when the recipe is gone.
   */
  public async recordFailure(
    agentId: string,
    id: string,
    failure: { readonly error: string; readonly limit: number },
  ): Promise<AgentRecipeFailureOutcome | null> {
    const [row] = await this.database.query(
      `
        UPDATE agent_recipes
        SET
            failure_streak = failure_streak + 1,
            last_error = $error,
            is_active = CASE
                WHEN failure_streak + 1 >= $limit THEN FALSE
                ELSE is_active
            END,
            disabled_reason = CASE
                WHEN failure_streak + 1 >= $limit THEN COALESCE(disabled_reason, 'failed')
                ELSE disabled_reason
            END
        WHERE agent_id = $agent_id
            AND id = $id
        RETURNING failure_streak, is_active;
      `,
      { agent_id: agentId, id, error: failure.error, limit: failure.limit },
    );
    if (!row) return null;
    return {
      failureStreak: readCountColumn(row, 0, "failure_streak"),
      isActive: readBooleanColumn(row, 1, "is_active"),
    };
  }

  /**
   * Removes recipes.
   *
   * @returns How many were removed.
   */
  public async remove(
    agentId: string,
    ids: readonly string[],
  ): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      const rows = await this.database.query(
        `
          DELETE FROM agent_recipes
          WHERE agent_id = $agent_id
              AND id = $id
          RETURNING id;
        `,
        { agent_id: agentId, id },
      );
      removed += rows.length;
    }
    return removed;
  }
}
