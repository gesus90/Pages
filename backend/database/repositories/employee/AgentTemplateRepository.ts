import { readBooleanColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentInstructionTemplate,
  AgentInstructionTemplateInput,
} from "@/definition/AgentInstructionTemplate";

/** A template to store, with its identifier and whether it is a default. */
export interface NewAgentTemplate extends AgentInstructionTemplateInput {
  readonly id: string;
  readonly isDefault: boolean;
}

const COLUMNS = `
    id,
    name,
    description,
    content,
    is_default,
    created_at,
    updated_at`;

function readTemplate(row: readonly DatabaseValue[]): AgentInstructionTemplate {
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    description: readTextColumn(row, 2, "description"),
    content: readTextColumn(row, 3, "content"),
    isDefault: readBooleanColumn(row, 4, "is_default"),
    createdAt: readTextColumn(row, 5, "created_at"),
    updatedAt: readTextColumn(row, 6, "updated_at"),
  };
}

/** The key that keeps names unique without regard to case. */
function nameKey(name: string): string {
  return name.toLocaleLowerCase("und");
}

/**
 * The templates of `AGENT.md` of the instance (PAGE-283).
 *
 * @remarks
 * A name is unique without regard to case; a second template of the same
 * name fails on the constraint of `name_key`.
 */
export class AgentTemplateRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Every template, the defaults first, then by name. */
  public async list(): Promise<AgentInstructionTemplate[]> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_instruction_templates
        ORDER BY is_default DESC, name_key, id;
      `,
    );
    return rows.map(readTemplate);
  }

  /** One template, or `null` when it does not exist. */
  public async find(id: string): Promise<AgentInstructionTemplate | null> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_instruction_templates
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];
    return row ? readTemplate(row) : null;
  }

  /**
   * Stores a new template.
   *
   * @throws The unique violation of `name_key` for a name already in use.
   */
  public async insert(template: NewAgentTemplate): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_instruction_templates (
            id,
            name,
            name_key,
            description,
            content,
            is_default
        )
        VALUES (
            $id,
            $name,
            $name_key,
            $description,
            $content,
            $is_default
        );
      `,
      {
        id: template.id,
        name: template.name,
        name_key: nameKey(template.name),
        description: template.description,
        content: template.content,
        is_default: template.isDefault,
      },
    );
  }

  /**
   * Replaces name, description and content of a template.
   *
   * @returns Whether the template existed.
   * @throws The unique violation of `name_key` for a name already in use.
   */
  public async update(
    id: string,
    input: AgentInstructionTemplateInput,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_instruction_templates
        SET
            name = $name,
            name_key = $name_key,
            description = $description,
            content = $content,
            updated_at = utc_now()
        WHERE id = $id
        RETURNING id;
      `,
      {
        id,
        name: input.name,
        name_key: nameKey(input.name),
        description: input.description,
        content: input.content,
      },
    );
    return rows.length === 1;
  }

  /**
   * Removes a template.
   *
   * @returns Whether the template existed.
   */
  public async remove(id: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        DELETE FROM agent_instruction_templates
        WHERE id = $id
        RETURNING id;
      `,
      { id },
    );
    return rows.length === 1;
  }

  /** Whether the defaults were stored once already. */
  public async isSeeded(): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT is_seeded
        FROM agent_instruction_template_seeding
        WHERE id = 1;
      `,
    );
    const row = rows[0];
    return row === undefined || readBooleanColumn(row, 0, "is_seeded");
  }

  /**
   * Marks the defaults as stored, exactly once for the instance.
   *
   * @returns Whether this call set the mark, and so has to store the defaults.
   */
  public async claimSeeding(): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_instruction_template_seeding
        SET is_seeded = TRUE
        WHERE id = 1
            AND is_seeded = FALSE
        RETURNING id;
      `,
    );
    return rows.length === 1;
  }
}
