import { AgentWorkspaceReferencesRepository } from "./AgentWorkspaceReferencesRepository";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { isUniqueViolationOn } from "@/backend/database/Database";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  isPlanTemplateNode,
  isPlanTemplateType,
  planTemplateNameKey,
} from "@/definition/AgentPlanNodeTemplate";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

const TEMPLATE_COLUMNS = `
    id,
    name,
    node_type,
    node_json,
    created_at,
    department_id
`;

/** A template as it is written; the database adds the time it was saved. */
export interface AgentPlanTemplateWrite {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly node: AgentPlanTemplateNode;
  /** The project and department a shared template belongs to; `null` for a personal one. */
  readonly team: {
    readonly projectId: string;
    readonly departmentId: string;
  } | null;
}

/** A change of a stored template: a new name, a new node, or both. */
export interface AgentPlanTemplateChange {
  readonly id: string;
  /** Only the owner changes a template; any other account finds none to change. */
  readonly ownerId: string;
  readonly name: string | null;
  readonly node: AgentPlanTemplateNode | null;
}

/** Runs inside the commit of a template change, for example to record its result. */
export type AgentPlanTemplateJournal = (
  transaction: DatabaseTransaction,
  template: AgentPlanNodeTemplate,
) => Promise<void>;

/**
 * Whose templates a read may return.
 *
 * @remarks
 * The service resolves it from the current account: the personal templates of
 * `ownerId`, and the shared templates of `projectId` that belong to one of the
 * departments the person is a member or leader of right now.
 */
export interface AgentPlanTemplateScope {
  readonly ownerId: string;
  /** The project whose shared templates count; `null` for personal ones only. */
  readonly projectId: string | null;
  readonly departmentIds: readonly string[];
}

/** The condition and parameters that limit a read to a scope. */
function scopeCondition(scope: AgentPlanTemplateScope): {
  readonly condition: string;
  readonly parameters: SqlParameters;
} {
  const departments = scope.projectId === null ? [] : scope.departmentIds;
  const parameters: Record<string, string> = { owner_id: scope.ownerId };
  if (departments.length === 0 || scope.projectId === null)
    return {
      condition: "(project_id IS NULL AND owner_id = $owner_id)",
      parameters,
    };
  parameters.project_id = scope.projectId;
  const placeholders = departments.map((department, index) => {
    parameters[`department_${index}`] = department;
    return `$department_${index}`;
  });
  return {
    condition: `(
        (project_id IS NULL AND owner_id = $owner_id)
        OR (
            project_id = $project_id
            AND department_id IN (${placeholders.join(", ")})
        )
    )`,
    parameters,
  };
}

/**
 * Reads one stored template.
 *
 * @returns `null` for a node type this version does not know, so a template
 * of a later version never breaks the list.
 */
function readTemplate(
  row: readonly DatabaseValue[],
): AgentPlanNodeTemplate | null {
  const type = readTextColumn(row, 2, "node_type");
  if (!isPlanTemplateType(type)) return null;
  const node = readPlanNode(JSON.parse(readTextColumn(row, 3, "node_json")));
  if (node.type !== type || !isPlanTemplateNode(node))
    throw new AgentError("template_invalid");
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    type,
    isShared: readNullableTextColumn(row, 5, "department_id") !== null,
    createdAt: readTextColumn(row, 4, "created_at"),
    node,
  };
}

async function findTemplate(
  database: Pick<DatabaseTransaction, "query">,
  scope: AgentPlanTemplateScope,
  id: string,
): Promise<AgentPlanNodeTemplate | null> {
  const { condition, parameters } = scopeCondition(scope);
  const [row] = await database.query(
    `
    SELECT ${TEMPLATE_COLUMNS}
    FROM agent_plan_templates
    WHERE id = $id
        AND ${condition};
  `,
    { ...parameters, id },
  );
  return row ? readTemplate(row) : null;
}

/** The team of a template its owner keeps, read before the owner changes it. */
async function findOwnedTeam(
  database: Pick<DatabaseTransaction, "query">,
  ownerId: string,
  id: string,
): Promise<AgentPlanTemplateScope | null> {
  const [row] = await database.query(
    `
    SELECT
        project_id,
        department_id
    FROM agent_plan_templates
    WHERE id = $id
        AND owner_id = $owner_id;
  `,
    { id, owner_id: ownerId },
  );
  if (!row) return null;
  const departmentId = readNullableTextColumn(row, 1, "department_id");
  return {
    ownerId,
    projectId: readNullableTextColumn(row, 0, "project_id"),
    departmentIds: departmentId === null ? [] : [departmentId],
  };
}

/** Refuses a name the owner already uses for another template. */
async function requireFreeName(
  database: Pick<DatabaseTransaction, "query">,
  change: { readonly ownerId: string; readonly id: string },
  nameKey: string,
): Promise<void> {
  const [taken] = await database.query(
    `
    SELECT id
    FROM agent_plan_templates
    WHERE owner_id = $owner_id
        AND name_key = $name_key
        AND id <> $id;
  `,
    { owner_id: change.ownerId, name_key: nameKey, id: change.id },
  );
  if (taken) throw new AgentError("template_name_taken");
}

/**
 * Stores the node templates of the plan editor, personal and shared.
 *
 * @remarks
 * Every read names a scope, so persistence only returns the person's own
 * templates and the shared ones of the project and departments the scope
 * lists. Only the owner renames, replaces or deletes a template; its team
 * stays as it was saved. A shared template is the same stored row for every
 * member and leader of its team.
 */
export class AgentPlanTemplateRepository {
  private readonly database: Pick<Database, "transaction" | "query">;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
  }

  /** Lists the templates of the scope, the newest first. */
  public async list(
    scope: AgentPlanTemplateScope,
  ): Promise<readonly AgentPlanNodeTemplate[]> {
    const { condition, parameters } = scopeCondition(scope);
    const rows = await this.database.query(
      `
      SELECT ${TEMPLATE_COLUMNS}
      FROM agent_plan_templates
      WHERE ${condition}
      ORDER BY created_at DESC, name_key, id;
    `,
      parameters,
    );
    return rows.flatMap((row) => readTemplate(row) ?? []);
  }

  /** Reads one template of the scope; any other template reads as missing. */
  public async find(
    scope: AgentPlanTemplateScope,
    id: string,
  ): Promise<AgentPlanNodeTemplate | null> {
    return findTemplate(this.database, scope, id);
  }

  /**
   * Adds a template under a name the owner does not use yet.
   *
   * @throws {AgentError} `template_name_taken` when the owner already has a
   * template of that name, compared without surrounding spaces and case; the
   * existing template stays as it is. Shared templates follow this rule per
   * owner as well; no further name rule applies to them.
   */
  public async create(
    template: AgentPlanTemplateWrite,
    journal?: (
      transaction: DatabaseTransaction,
      template: AgentPlanNodeTemplate,
    ) => Promise<void>,
  ): Promise<AgentPlanNodeTemplate> {
    const nameKey = planTemplateNameKey(template.name);
    try {
      return await this.database.transaction(async (transaction) => {
        await new AgentWorkspaceReferencesRepository(
          transaction,
        ).requireReferences(template.node);
        const [taken] = await transaction.query(
          `
          SELECT id
          FROM agent_plan_templates
          WHERE owner_id = $owner_id
              AND name_key = $name_key;
        `,
          { owner_id: template.ownerId, name_key: nameKey },
        );
        if (taken) throw new AgentError("template_name_taken");
        await transaction.execute(
          `
          INSERT INTO agent_plan_templates (
              id,
              owner_id,
              name,
              name_key,
              node_type,
              node_json,
              project_id,
              department_id
          )
          VALUES (
              $id,
              $owner_id,
              $name,
              $name_key,
              $node_type,
              $node_json,
              $project_id,
              $department_id
          );
        `,
          {
            id: template.id,
            owner_id: template.ownerId,
            name: template.name,
            name_key: nameKey,
            node_type: template.node.type,
            node_json: JSON.stringify(template.node),
            project_id: template.team?.projectId ?? null,
            department_id: template.team?.departmentId ?? null,
          },
        );
        const created = await findTemplate(
          transaction,
          {
            ownerId: template.ownerId,
            projectId: template.team?.projectId ?? null,
            departmentIds: template.team ? [template.team.departmentId] : [],
          },
          template.id,
        );
        if (!created) throw new AgentError("template_invalid");
        await journal?.(transaction, created);
        return created;
      });
    } catch (error: unknown) {
      // A save of the same name in parallel loses here instead of doubling it.
      if (isUniqueViolationOn(error, "owner_id"))
        throw new AgentError("template_name_taken");
      throw error;
    }
  }
  /**
   * Renames a template of its owner, replaces its node, or both.
   *
   * @param change - The template, its owner and what changes.
   * @param journal - Runs in the same commit with the changed template.
   * @returns The template as stored after the change.
   * @throws {AgentError} `template_owner_only` when the template is not the
   * owner's, `template_name_taken` for a name the owner uses for another
   * template.
   */
  public async update(
    change: AgentPlanTemplateChange,
    journal?: AgentPlanTemplateJournal,
  ): Promise<AgentPlanNodeTemplate> {
    const nameKey =
      change.name === null ? null : planTemplateNameKey(change.name);
    try {
      return await this.database.transaction(async (transaction) => {
        const scope = await findOwnedTeam(
          transaction,
          change.ownerId,
          change.id,
        );
        if (!scope) throw new AgentError("template_owner_only");
        if (change.node)
          await new AgentWorkspaceReferencesRepository(
            transaction,
          ).requireReferences(change.node);
        if (nameKey !== null)
          await requireFreeName(transaction, change, nameKey);
        await transaction.execute(
          `
          UPDATE agent_plan_templates
          SET
              name = COALESCE($name, name),
              name_key = COALESCE($name_key, name_key),
              node_type = COALESCE($node_type, node_type),
              node_json = COALESCE($node_json, node_json)
          WHERE id = $id
              AND owner_id = $owner_id;
        `,
          {
            id: change.id,
            owner_id: change.ownerId,
            name: change.name,
            name_key: nameKey,
            node_type: change.node?.type ?? null,
            node_json: change.node ? JSON.stringify(change.node) : null,
          },
        );
        const updated = await findTemplate(transaction, scope, change.id);
        if (!updated) throw new AgentError("template_invalid");
        await journal?.(transaction, updated);
        return updated;
      });
    } catch (error: unknown) {
      // A rename to the same name in parallel loses here instead of doubling it.
      if (isUniqueViolationOn(error, "owner_id"))
        throw new AgentError("template_name_taken");
      throw error;
    }
  }

  /**
   * Deletes a template of its owner.
   *
   * @param template - The template and its owner.
   * @param journal - Runs in the same commit with the template as it was.
   * @throws {AgentError} `template_owner_only` when the template is not the owner's.
   *
   * @remarks
   * Copies inserted into plans are independent nodes and stay.
   */
  public async remove(
    template: { readonly id: string; readonly ownerId: string },
    journal?: AgentPlanTemplateJournal,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const scope = await findOwnedTeam(
        transaction,
        template.ownerId,
        template.id,
      );
      const removed = scope
        ? await findTemplate(transaction, scope, template.id)
        : null;
      if (!removed) throw new AgentError("template_owner_only");
      await transaction.execute(
        `
        DELETE FROM agent_plan_templates
        WHERE id = $id
            AND owner_id = $owner_id;
      `,
        { id: template.id, owner_id: template.ownerId },
      );
      await journal?.(transaction, removed);
    });
  }
}
