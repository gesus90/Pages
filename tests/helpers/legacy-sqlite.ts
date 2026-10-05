import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import SqliteDatabase from "better-sqlite3";

export const LEGACY_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../backend/database/migrations", import.meta.url),
);

/** Names of the frozen SQLite migrations, in the order they ran. */
export function listLegacyMigrationNames(): string[] {
  return readdirSync(LEGACY_MIGRATIONS_DIRECTORY)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
}

/**
 * Creates a SQLite database the way the former Pages version left it: every
 * frozen migration applied and recorded in `schema_migrations`.
 *
 * @param databasePath - File to create.
 * @returns The open database, so a test can fill or change it.
 */
export function createLegacyDatabase(
  databasePath: string,
): SqliteDatabase.Database {
  const legacy = new SqliteDatabase(databasePath);

  // Table rebuilds in the legacy migrations need enforcement switched off,
  // exactly like the former migration runner did.
  legacy.pragma("foreign_keys = OFF");
  legacy.exec(
    "CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
  );

  for (const name of listLegacyMigrationNames()) {
    legacy.exec(
      readFileSync(path.join(LEGACY_MIGRATIONS_DIRECTORY, name), "utf8"),
    );
    legacy
      .prepare("INSERT INTO schema_migrations (name) VALUES (?);")
      .run(name);
  }

  return legacy;
}

/** Rows for every table of the final schema, with NULLs and binary data. */
const SAMPLE_STATEMENTS = [
  "INSERT INTO users (id, username, display_name, password_hash, email, role, is_active, avatar_type, avatar_icon, avatar_color, avatar_image_url, created_at, updated_at) VALUES ('u1', 'admin', 'Administrator', 'hash-1', 'admin@example.invalid', 'admin', 1, 'initials', NULL, NULL, NULL, '2026-01-01 10:00:00', '2026-01-02 10:00:00'), ('u2', 'anna', 'Anna Müller', 'hash-2', NULL, 'employee', 0, 'icon', 'rocket', '#ff0000', NULL, '2026-01-03 10:00:00', '2026-01-03 10:00:00')",
  "INSERT INTO user_avatars (user_id, mime_type, filename, data, updated_at) VALUES ('u2', 'image/png', 'anna.png', X'89504E470D0A1A0A00FF', '2026-01-04 10:00:00')",
  "INSERT INTO user_settings (user_id, language, timezone, date_format, week_start, notify_email, notify_desktop, notify_mentions, notify_assignments, notify_due_dates, notify_weekly_summary) VALUES ('u1', 'en', 'Europe/Berlin', 'YYYY-MM-DD', 'monday', 1, 0, NULL, 1, 0, NULL), ('u2', 'de', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
  "INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) VALUES ('s1', 'u1', 'token-1', 'Firefox on Linux', '2999-01-01 00:00:00'), ('s2', 'u2', 'token-2', NULL, '2999-01-01 00:00:00')",
  "INSERT INTO projects (id, name, description, owner_id, parent_id, manager_id, status, progress, placeholder_color, start_date, target_date, notes, archived_at) VALUES ('p1', 'Pages', 'Wiki und Projekte', 'u1', NULL, 'u2', 'active', 40, '#FCE3D3', '2026-01-01', '2026-12-31', 'Notizen', NULL), ('p2', 'Interne Tools', NULL, 'u1', 'p1', NULL, 'planned', 0, '#D3E3FC', NULL, NULL, '', '2026-02-01 00:00:00')",
  "INSERT INTO project_keys (project_id, key) VALUES ('p1', 'PAGE'), ('p2', 'TOOL')",
  "INSERT INTO project_icons (project_id, mime_type, filename, data) VALUES ('p1', 'image/png', 'icon.png', X'0102030405')",
  "INSERT INTO project_members (project_id, user_id, role) VALUES ('p1', 'u1', 'manager'), ('p1', 'u2', 'member')",
  "INSERT INTO project_goals (id, project_id, title, is_done, position) VALUES ('g1', 'p1', 'Release', 0, 1), ('g2', 'p1', 'Docs', 1, 2)",
  "INSERT INTO project_tags (project_id, tag) VALUES ('p1', 'intern'), ('p1', 'wiki')",
  "INSERT INTO project_events (id, project_id, title, description, event_date, event_time, type, archived_at) VALUES ('e1', 'p1', 'Kickoff', '', '2026-01-05', '09:30', 'meeting', NULL)",
  "INSERT INTO project_activity (id, project_id, user_id, category, action, message) VALUES ('a1', 'p1', 'u1', 'tasks', 'created', 'Aufgabe angelegt')",
  "INSERT INTO project_integrations (project_id, repo_url, repo_name, token_hash, token_encrypted, has_token, sync_issues, sync_status, sync_comments, sync_pull_requests, sync_commits, sync_direction, sync_interval_minutes, is_connected, last_sync_at, next_sync_at) VALUES ('p1', 'https://github.com/acme/pages', 'acme/pages', NULL, 'v1:encrypted', 1, 1, 1, 1, 0, 0, 'bidirectional', 15, 1, '2026-03-01 10:00:00', NULL)",
  "UPDATE workflow_statuses SET name = 'In Bearbeitung' WHERE id = 'status-in-progress'",
  "INSERT INTO milestones (id, project_id, name, description, status, color_key, icon_key, color_custom, start_at, due_at, completed_at, archived_at) VALUES ('m1', 'p1', 'MVP', 'Erste Version', 'open', 'release', 'rocket', '#a1b2c3', '2026-01-01', '2026-06-30', NULL, NULL), ('m2', 'p1', 'Beta', NULL, 'completed', NULL, NULL, NULL, NULL, NULL, '2026-05-01 00:00:00', NULL)",
  "INSERT INTO milestone_dependencies (id, project_id, source_id, target_id, link_type) VALUES ('d1', 'p1', 'm1', 'm2', 'blocks')",
  "INSERT INTO work_items (id, project_id, key, number, type, parent_id, title, description, status_id, priority, assignee_id, created_by, milestone_id, start_at, due_at, sort_order, completed_at, archived_at, github_issue_number, github_issue_url, github_issue_state, github_issue_updated_at, github_content_hash, github_conflict, github_last_sync_at, github_last_error) VALUES ('w1', 'p1', 'PAGE-1', 1, 'epic', NULL, 'Wiki', 'Beschreibung', 'status-todo', 'high', 'u2', 'u1', 'm1', NULL, '2026-04-01', 1, NULL, NULL, 12, 'https://github.com/acme/pages/issues/12', 'open', '2026-03-02 10:00:00', 'abc123', 0, '2026-03-02 10:00:00', NULL), ('w2', 'p1', 'PAGE-2', 2, 'task', 'w1', 'Seiten', '', 'status-done', 'normal', NULL, 'u1', NULL, NULL, NULL, 2, '2026-03-05 10:00:00', NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL, 'Sync fehlgeschlagen')",
  "INSERT INTO work_item_history (id, work_item_id, user_id, action, field, old_value, new_value) VALUES ('h1', 'w1', 'u1', 'updated', 'title', 'Wikis', 'Wiki'), ('h2', 'w2', 'u1', 'created', NULL, NULL, NULL)",
  "INSERT INTO work_item_checklist_items (id, work_item_id, title, is_done, sort_order) VALUES ('c1', 'w1', 'Entwurf', 1, 1)",
  "INSERT INTO work_item_links (id, work_item_id, linked_work_item_id, link_type) VALUES ('l1', 'w1', 'w2', 'relates_to')",
  "INSERT INTO project_labels (id, project_id, name, color) VALUES ('lb1', 'p1', 'Bug', '#ef4444')",
  "INSERT INTO work_item_labels (work_item_id, label_id) VALUES ('w1', 'lb1')",
  "INSERT INTO github_external_issues (id, project_id, issue_number, title, url, state, dismissed, imported_work_item_id) VALUES ('x1', 'p1', 7, 'Remote Fehler', 'https://example.invalid/7', 'open', 0, NULL)",
  "INSERT INTO github_pull_requests (id, project_id, number, title, url, state, merged, branch, work_item_id) VALUES ('pr1', 'p1', 42, 'Fix', 'https://example.invalid/pr/42', 'closed', 1, 'fix/wiki', 'w1')",
  "INSERT INTO tasks (id, project_id, assignee_id, title, description, status) VALUES ('t1', 'p1', 'u1', 'Legacy', NULL, 'open')",
  "INSERT INTO wiki_pages (id, project_id, author_id, title, content) VALUES ('wp1', 'p1', 'u1', 'Start', '# Hallo')",
];

/**
 * Fills a legacy database with artificial rows in every table.
 *
 * @param legacy - Database created by {@link createLegacyDatabase}.
 */
export function fillLegacyDatabase(legacy: SqliteDatabase.Database): void {
  for (const statement of SAMPLE_STATEMENTS) {
    legacy.exec(statement);
  }
}
