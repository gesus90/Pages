import { interpreterProfilesSchema } from "@/definition/InterpreterProfile";

import type {
  InterpreterCheck,
  InterpreterProfile,
  InterpreterSnapshot,
} from "@/definition/InterpreterProfile";

/** An editable profile with a volatile path-bound observation. */
export interface InterpreterRow {
  readonly profile: InterpreterProfile;
  readonly check?: InterpreterCheck;
  readonly isChecking: boolean;
}

/** Builds an editor baseline from a server-confirmed snapshot. */
export function interpreterRows(
  snapshot: InterpreterSnapshot,
): InterpreterRow[] {
  return snapshot.profiles.map((profile) => ({
    profile,
    check: snapshot.checks[profile.id],
    isChecking: false,
  }));
}

/** Compares only configured facts, leaving volatile observations outside the baseline. */
export function isChangedInterpreterRow(
  row: InterpreterRow,
  saved: InterpreterSnapshot,
): boolean {
  const original = saved.profiles.find(
    (profile) => profile.id === row.profile.id,
  );
  const configuredProfile = { ...row.profile, name: row.profile.name.trim() };
  return JSON.stringify(original) !== JSON.stringify(configuredProfile);
}

/** Unchanged saved failures do not block correction of other profiles. */
export function canSaveInterpreterRows(
  rows: readonly InterpreterRow[],
  saved: InterpreterSnapshot,
): boolean {
  const parsed = interpreterProfilesSchema.safeParse(
    rows.map((row) => row.profile),
  );
  if (
    rows.some((row) => row.isChecking) ||
    !parsed.success ||
    JSON.stringify(parsed.data) === JSON.stringify(saved.profiles)
  )
    return false;
  return rows.every((row) => {
    if (!isChangedInterpreterRow(row, saved)) return true;
    return row.check?.status === "ok" && row.check.path === row.profile.path;
  });
}
