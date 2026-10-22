import { randomUUID } from "node:crypto";

import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { RunnerDeployKey } from "@/definition/RunnerGitHub";

/** Stores offline key registrations in Pages without implying a GitHub side effect. */
export class RunnerDeployKeyRepository {
  private readonly database: Database;
  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the persisted offline keys for one project. */
  public async list(projectId: string): Promise<readonly RunnerDeployKey[]> {
    const rows = await this.database.query(
      `
      SELECT
          key_id,
          public_key,
          title
      FROM runner_deploy_keys
      WHERE project_id = $project_id;
    `,
      { project_id: projectId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "key_id"),
      key: readTextColumn(row, 1, "public_key"),
      title: readTextColumn(row, 2, "title"),
    }));
  }

  /** Idempotently records the public key; no private key belongs in this table. */
  public async create(input: {
    readonly projectId: string;
    readonly key: string;
    readonly title: string;
  }): Promise<RunnerDeployKey> {
    await this.database.execute(
      `
      INSERT INTO runner_deploy_keys (
          project_id,
          key_id,
          public_key,
          title
      ) VALUES (
          $project_id,
          $key_id,
          $public_key,
          $title
      ) ON CONFLICT (project_id, public_key) DO NOTHING;
    `,
      {
        project_id: input.projectId,
        key_id: randomUUID(),
        public_key: input.key,
        title: input.title,
      },
    );
    const stored = (await this.list(input.projectId)).find(
      (entry) => entry.key === input.key,
    );
    if (!stored) throw new Error("Offline deploy key was not stored");
    return stored;
  }
}
