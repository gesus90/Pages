import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { isUniqueViolationOn } from "@/backend/database/Database";
import { readTextColumn } from "@/backend/database/RowValue";
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
    created_at
`;

/** A template as it is written; the database adds the time it was saved. */
export interface AgentPlanTemplateWrite {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly node: AgentPlanTemplateNode;
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
    createdAt: readTextColumn(row, 4, "created_at"),
    node,
  };
}

async function findTemplate(
  database: Pick<DatabaseTransaction, "query">,
  ownerId: string,
  id: string,
): Promise<AgentPlanNodeTemplate | null> {
  const [row] = await database.query(
    `
    SELECT ${TEMPLATE_COLUMNS}
    FROM agent_plan_templates
    WHERE id = $id
        AND owner_id = $owner_id;
  `,
    { id, owner_id: ownerId },
  );
  return row ? readTemplate(row) : null;
}

/**
 * Stores the personal node templates of the plan editor.
 *
 * @remarks
 * Every read names the owner, so persistence never returns another
 * person's template. Templates are only added; nothing here changes or
 * deletes one.
 */
export class AgentPlanTemplateRepository {
  private readonly database: Pick<Database, "transaction" | "query">;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
  }

  /** Lists the owner's templates, the newest first. */
  public async list(
    ownerId: string,
  ): Promise<readonly AgentPlanNodeTemplate[]> {
    const rows = await this.database.query(
      `
      SELECT ${TEMPLATE_COLUMNS}
      FROM agent_plan_templates
      WHERE owner_id = $owner_id
      ORDER BY created_at DESC, name_key, id;
    `,
      { owner_id: ownerId },
    );
    return rows.flatMap((row) => readTemplate(row) ?? []);
  }

  /** Reads one of the owner's templates; another person's template reads as missing. */
  public async find(
    ownerId: string,
    id: string,
  ): Promise<AgentPlanNodeTemplate | null> {
    return findTemplate(this.database, ownerId, id);
  }

  /**
   * Adds a template under a name the owner does not use yet.
   *
   * @throws {AgentError} `template_name_taken` when the owner already has a
   * template of that name, compared without surrounding spaces and case; the
   * existing template stays as it is.
   */
  public async create(
    template: AgentPlanTemplateWrite,
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
              node_json
          )
          VALUES (
              $id,
              $owner_id,
              $name,
              $name_key,
              $node_type,
              $node_json
          );
        `,
          {
            id: template.id,
            owner_id: template.ownerId,
            name: template.name,
            name_key: nameKey,
            node_type: template.node.type,
            node_json: JSON.stringify(template.node),
          },
        );
        const created = await findTemplate(
          transaction,
          template.ownerId,
          template.id,
        );
        if (!created) throw new AgentError("template_invalid");
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
