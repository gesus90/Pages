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

/**
 * Stores the node templates of the plan editor, personal and shared.
 *
 * @remarks
 * Every read names a scope, so persistence only returns the person's own
 * templates and the shared ones of the project and departments the scope
 * lists. Templates are only added; nothing here changes or deletes one, and a
 * shared template is the same stored row for every member and leader of its
 * team.
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
}
