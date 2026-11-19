import path from "node:path";

import { Database } from "@/backend/database/Database";
import { postgresErrorCode } from "@/backend/database/postgres/PostgresConnection";
import { PostgresLocaleError } from "@/backend/database/postgres/PostgresLocale";

import { readMigrations } from "../read-database-migrations";
import { DuckDbSource } from "./duckdb-source";
import {
  copyTable,
  prepareTarget,
  readForeignKeys,
  readTargetColumns,
  readTargetRows,
  readTargetSequences,
  refuseTargetWithData,
  setTargetSequence,
} from "./postgres-target";
import { cleanRows } from "./nul-removal";
import { checksumRows } from "./table-checksum";
import { planTables } from "./table-plan";
import { printReport } from "./transfer-report";
import { TransferRefusal } from "./transfer-refusal";

import type { RemovedNulCounts } from "./nul-removal";
import type { SequenceOutcome, TableOutcome } from "./transfer-report";
import type { TablePlan } from "./table-plan";

const EXIT_SUCCESS = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = [
  "Usage: pnpm run db:transfer -- --from <duckdb-file> --to <postgres-url> [--verify-only]",
  "",
  "Copies a stopped Pages DuckDB file, opened read-only, into a PostgreSQL database",
  "without business data and compares row count and checksum of every table.",
  "--verify-only compares without writing. See docs/PostgresMigration.md.",
].join("\n");

const POSTGRES_URL = /^postgres(?:ql)?:\/\//u;

/** SQLSTATE of a duplicate key, which the removal of U+0000 can cause. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Frozen DuckDB migration names required in `schema_migrations` of a source
 * file before transfer. Their SQL files were removed after PostgreSQL
 * `001_baseline.sql` and `004`–`009` captured the final schema.
 */
const EXPECTED_DUCKDB_MIGRATIONS: readonly string[] = [
  "001_baseline.sql",
  "002_instance_settings.sql",
  "003_username_case_insensitive.sql",
  "004_password_change_required.sql",
  "005_user_authorization.sql",
  "006_legacy_user_roles.sql",
  "007_project_departments.sql",
  "008_project_permissions.sql",
  "009_work_item_departments.sql",
  "010_project_templates.sql",
  "011_project_activity_work_items.sql",
  "012_user_groups.sql",
  "013_global_labels.sql",
  "014_work_item_templates.sql",
  "015_github_sync_switch.sql",
  "016_user_board_preferences.sql",
  "017_ticket_number_counter.sql",
  "018_instance_logo.sql",
  "019_wiki.sql",
  "020_agent_connections.sql",
  "021_agent_model_catalogs.sql",
  "022_agent_reasoning_effort.sql",
  "023_wiki_page_cover.sql",
  "024_ticket_attachments_and_tree.sql",
  "025_text_assistant.sql",
  "026_agent_function_assignments.sql",
  "027_mcp_authorization.sql",
  "028_agent_assets.sql",
  "029_agent_imports.sql",
  "030_agent_execution_profiles.sql",
  "031_agent_configuration.sql",
  "032_agent_workspaces.sql",
  "033_agent_plans.sql",
  "034_project_activity_wiki_source.sql",
  "035_mcp_pairing.sql",
  "036_chat.sql",
  "037_milestone_initiatives.sql",
  "038_administration_activity.sql",
  "039_agent_connection_scopes.sql",
  "040_user_theme.sql",
  "041_agent_workspace_project_access.sql",
  "042_page_agents.sql",
  "043_remove_oauth.sql",
  "044_agent_run_credentials.sql",
  "045_opencode_connections.sql",
  "046_work_item_checklist_revisions.sql",
  "047_agent_run_credential_reach.sql",
  "048_discord.sql",
  "049_chat_context.sql",
  "050_acp_resource_leases.sql",
  "051_chat_acp_jobs.sql",
  "052_chat_message_client_ids.sql",
  "053_chat_job_cost_estimate.sql",
  "054_chat_message_stopped.sql",
  "055_opencode_acp_resource_leases.sql",
  "056_agent_session_journal.sql",
  "057_agent_plan_recovery.sql",
  "058_chat_attachment_origin.sql",
  "059_remove_text_assistant.sql",
  "060_agent_plan_continuations.sql",
  "061_agent_plan_templates.sql",
  "062_agent_plan_teams.sql",
  "063_mcp_http_oauth.sql",
  "064_agent_plan_loops.sql",
  "065_agent_plan_recovery_executions.sql",
  "066_pica_settings.sql",
  "067_user_design_theme.sql",
  "068_remote_connections.sql",
  "069_remote_allowed_roots.sql",
  "070_remote_workspace_check_roots.sql",
  "071_pages_runners.sql",
  "072_runner_plan_events.sql",
  "073_remote_install_findings.sql",
  "074_user_terminal_screen_reader.sql",
  "075_zai_account_type.sql",
  "076_agent_session_history_chunks.sql",
  "077_runner_history_recovery.sql",
  "078_agent_asset_revisions.sql",
  "079_agent_plan_work.sql",
  "080_agent_plan_start_rejections.sql",
  "081_agent_plan_cleanup_failures.sql",
  "082_antigravity_acp.sql",
  "083_acp_namespace_identity.sql",
  "084_agent_workspace_cleanup.sql",
  "085_rebuild_buffered_secondary_indexes.sql",
  "086_pica_mobile_notifications.sql",
  "087_agent_plan_loop_counts.sql",
  "088_agent_plan_step_reports.sql",
  "089_saved_list_order.sql",
  "090_creation_order.sql",
  "091_run_creation_order.sql",
  "092_messaging_creation_order.sql",
  "093_core_creation_order.sql",
];

/** What the check of the tables takes from the run and adds to it. */
interface TableCheck {
  readonly copyDurations: ReadonlyMap<string, number>;
  readonly removedNul: RemovedNulCounts;
}

interface TransferArguments {
  readonly from: string;
  readonly to: string;
  readonly isVerifyOnly: boolean;
}

/** `pnpm run` hands on the `--` of its own command line. */
function parseArguments(argv: readonly string[]): TransferArguments | null {
  const parts = argv.filter((part) => part !== "--");
  const isVerifyOnly = parts.includes("--verify-only");
  const pairs = parts.filter((part) => part !== "--verify-only");
  const fromIndex = pairs.indexOf("--from");
  const toIndex = pairs.indexOf("--to");
  const from = pairs[fromIndex + 1];
  const to = pairs[toIndex + 1];
  if (
    pairs.length !== 4 ||
    fromIndex === -1 ||
    toIndex === -1 ||
    from === undefined ||
    to === undefined ||
    !POSTGRES_URL.test(to)
  )
    return null;
  return { from: path.resolve(from), to, isVerifyOnly };
}

async function refuseOtherSchemaLevel(source: DuckDbSource): Promise<void> {
  const applied = await source.readAppliedMigrations();
  const missing = EXPECTED_DUCKDB_MIGRATIONS.filter(
    (name) => !applied.includes(name),
  );
  const unknown = applied.filter(
    (name) => !EXPECTED_DUCKDB_MIGRATIONS.includes(name),
  );
  if (missing.length > 0 || unknown.length > 0)
    throw new TransferRefusal(
      `The DuckDB file is not on the schema of this version (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}). Run this version on it once and stop it cleanly.`,
    );
}

async function planTransfer(
  source: DuckDbSource,
  database: Database,
): Promise<readonly TablePlan[]> {
  return planTables({
    sourceColumns: await source.readColumns(),
    targetColumns: await readTargetColumns(database),
    primaryKeys: await source.readPrimaryKeys(),
    foreignKeys: await readForeignKeys(database),
  });
}

async function copyTables(
  source: DuckDbSource,
  database: Database,
  plans: readonly TablePlan[],
): Promise<ReadonlyMap<string, number>> {
  const durations = new Map<string, number>();
  for (const plan of plans) {
    const startedAt = performance.now();
    try {
      await copyTable(database, plan, cleanRows(plan, source.readRows(plan)));
    } catch (error: unknown) {
      throw new TransferRefusal(describeCopyFailure(plan.name, error));
    }
    durations.set(plan.name, performance.now() - startedAt);
    console.info(`copied ${plan.name}`);
  }
  for (const [name, nextValue] of await source.readSequences())
    await setTargetSequence(database, name, nextValue);
  return durations;
}

async function checkTables(
  source: DuckDbSource,
  database: Database,
  plans: readonly TablePlan[],
  check: TableCheck,
): Promise<readonly TableOutcome[]> {
  const outcomes: TableOutcome[] = [];
  for (const plan of plans) {
    const startedAt = performance.now();
    const sourceSum = await checksumRows(
      cleanRows(plan, source.readRows(plan), check.removedNul),
    );
    const targetSum = await checksumRows(readTargetRows(database, plan));
    outcomes.push({
      table: plan.name,
      sourceRows: sourceSum.rows,
      targetRows: targetSum.rows,
      expectedChecksum: sourceSum.checksum,
      targetChecksum: targetSum.checksum,
      copyMs: check.copyDurations.get(plan.name) ?? null,
      checkMs: performance.now() - startedAt,
    });
  }
  return outcomes;
}

async function checkSequences(
  source: DuckDbSource,
  database: Database,
): Promise<readonly SequenceOutcome[]> {
  const sourceValues = await source.readSequences();
  const targetValues = await readTargetSequences(database);
  return [...new Set([...sourceValues.keys(), ...targetValues.keys()])]
    .sort()
    .map((sequence) => ({
      sequence,
      sourceNext: sourceValues.get(sequence) ?? null,
      targetNext: targetValues.get(sequence) ?? null,
    }));
}

async function transferBetween(
  source: DuckDbSource,
  database: Database,
  isVerifyOnly: boolean,
): Promise<number> {
  const startedAt = performance.now();
  await refuseOtherSchemaLevel(source);
  if (!isVerifyOnly)
    await prepareTarget(database, await readMigrations("postgres/migrations"));
  const plans = await planTransfer(source, database);
  let copyDurations: ReadonlyMap<string, number> = new Map();
  if (!isVerifyOnly) {
    await refuseTargetWithData(database, plans);
    copyDurations = await copyTables(source, database, plans);
  }
  const removedNul: RemovedNulCounts = new Map();
  return printReport({
    tables: await checkTables(source, database, plans, {
      copyDurations,
      removedNul,
    }),
    sequences: await checkSequences(source, database),
    removedNul: [...removedNul.values()],
    totalMs: performance.now() - startedAt,
    hasCopied: !isVerifyOnly,
  });
}

async function runTransfer(transfer: TransferArguments): Promise<number> {
  const source = await DuckDbSource.open(transfer.from);
  try {
    const database = await Database.connect(transfer.to);
    try {
      return await transferBetween(source, database, transfer.isVerifyOnly);
    } finally {
      await database.close();
    }
  } finally {
    source.close();
  }
}

/** Name and SQLSTATE only: the text of a driver error can quote a value or the URL. */
function describeError(error: unknown): string {
  const code = postgresErrorCode(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  return code === null ? name : `${name}, code ${code}`;
}

function describeCopyFailure(table: string, error: unknown): string {
  const reason =
    error instanceof TransferRefusal
      ? error.message
      : `Copying table ${table} failed (${describeError(error)}).`;
  const hint =
    postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION
      ? " Two keys can become equal once U+0000 is gone, see docs/PostgresMigration.md."
      : "";
  return `${reason}${hint} Earlier tables stay in the target: use a new database for the next attempt.`;
}

function describeFailure(error: unknown): string {
  return error instanceof TransferRefusal ||
    error instanceof PostgresLocaleError
    ? error.message
    : `The transfer failed (${describeError(error)}).`;
}

/**
 * Runs the transfer for command-line arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The exit code: 0 without a deviation, 1 on a deviation or failure, 2 on wrong usage.
 */
export async function runTransferCommand(
  argv: readonly string[],
): Promise<number> {
  const transfer = parseArguments(argv);
  if (transfer === null) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  try {
    return (await runTransfer(transfer)) === 0 ? EXIT_SUCCESS : EXIT_FAILED;
  } catch (error: unknown) {
    console.error(describeFailure(error));
    return EXIT_FAILED;
  }
}
