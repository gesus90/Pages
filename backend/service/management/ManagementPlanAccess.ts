import { AgentOperationError } from "@/backend/error/AgentOperationError";

/** Captures access selections by stable object IDs so reordering existing nodes grants nothing. */
function yoloSelections(input: unknown): ReadonlySet<string> {
  const paths = new Set<string>();
  const pending: { readonly input: unknown; readonly path: string }[] = [
    { input, path: "" },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current.input !== "object" || current.input === null)
      continue;
    for (const [key, entry] of Object.entries(current.input)) {
      const identity =
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        typeof entry.id === "string"
          ? entry.id
          : key;
      const path = `${current.path}/${identity}`;
      if (key === "access" && entry === "yolo") paths.add(path);
      if (typeof entry === "object" && entry !== null)
        pending.push({ input: entry, path });
    }
  }
  return paths;
}

/** Refuses new YOLO selections while allowing unrelated edits of existing plans. */
export function requireManagementPlanAccess(
  isManagement: boolean,
  proposed: unknown,
  previous: unknown,
): void {
  if (!isManagement) return;
  const existing = yoloSelections(previous);
  if ([...yoloSelections(proposed)].some((path) => !existing.has(path)))
    throw new AgentOperationError("FORBIDDEN", { reason: "access_level" });
}

/** Direct script execution remains unavailable to the business role, including remote or nested scripts. */
export function requireManagementScriptExecution(
  isManagement: boolean,
  input: unknown,
): void {
  if (!isManagement) return;
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) continue;
    if (
      "type" in current &&
      current.type === "script" &&
      !("disabled" in current && current.disabled === true)
    )
      throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
    pending.push(
      ...Object.values(current).filter(
        (entry) => typeof entry === "object" && entry !== null,
      ),
    );
  }
}
