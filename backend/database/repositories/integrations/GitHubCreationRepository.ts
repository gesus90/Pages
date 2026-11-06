import { readCountColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Journals the non-idempotent create request before it can leave the selected consumer. */
export class GitHubCreationRepository {
  private readonly database: Database;

  /** Uses the shared PostgreSQL database; no token or body is stored. */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns a confirmed issue number, if the create acknowledgement was persisted. */
  public async find(key: string): Promise<number | null> {
    const [row] = await this.database.query(
      `
      SELECT issue_number
      FROM integration_github_creations
      WHERE creation_key = $key;
    `,
      { key },
    );
    return !row || row[0] === null
      ? null
      : readCountColumn(row, 0, "issue_number");
  }

  /** Returns true only to the first attempt; an ambiguous send is never repeated blindly. */
  public async begin(key: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      INSERT INTO integration_github_creations (creation_key)
      VALUES ($key)
      ON CONFLICT (creation_key) DO NOTHING
      RETURNING creation_key;
    `,
      { key },
    );
    return rows.length === 1;
  }

  /** Records acknowledgement, including one recovered through the issue's stable marker. */
  public async confirm(key: string, issueNumber: number): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO integration_github_creations (creation_key, issue_number)
      VALUES ($key, $number)
      ON CONFLICT (creation_key)
      DO UPDATE SET issue_number = EXCLUDED.issue_number;
    `,
      { key, number: issueNumber },
    );
  }
}
