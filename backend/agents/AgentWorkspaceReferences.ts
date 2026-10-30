function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function referencesWorkspace(input: unknown, workspaceId: string): boolean {
  return isRecord(input) && input.workspaceId === workspaceId;
}

/** Registration identifiers used by structured references, excluding an explicitly empty binding. */
export function workspaceReferenceIds(input: unknown): ReadonlySet<string> {
  const identifiers = new Set<string>();
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (Array.isArray(entry)) pending.push(...entry);
    else if (isRecord(entry)) {
      if (
        typeof entry.workspaceId === "string" &&
        entry.workspaceId !== "" &&
        entry.workspaceId !== "missing-workspace"
      )
        identifiers.add(entry.workspaceId);
      pending.push(...Object.values(entry));
    }
  }
  return identifiers;
}

/** Clears registration bindings without deleting nodes, parameters, model settings or other content. */
export function withoutWorkspaceReferences(
  input: unknown,
  workspaceId: string,
): unknown {
  if (Array.isArray(input))
    return input.map((entry: unknown) =>
      withoutWorkspaceReferences(entry, workspaceId),
    );
  if (!isRecord(input)) return input;
  const fields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    // A removed remote route cannot turn into an executable local route: the
    // containing plan is detached and its old model selection stays unresolved.
    if (key === "executionTarget" && referencesWorkspace(entry, workspaceId)) {
      fields[key] = { kind: "remote", workspaceId: "missing-workspace" };
      continue;
    }
    if (key === "runnerRoute" && referencesWorkspace(entry, workspaceId))
      continue;
    if (key === "workspaceId" && entry === workspaceId) {
      fields[key] = "";
      continue;
    }
    const isNullable =
      key === "defaultValue" || (key === "value" && input.kind === "literal");
    fields[key] =
      isNullable && referencesWorkspace(entry, workspaceId)
        ? null
        : withoutWorkspaceReferences(entry, workspaceId);
  }
  return fields;
}
