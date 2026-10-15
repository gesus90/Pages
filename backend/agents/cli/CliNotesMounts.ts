import path from "node:path";
import { realpath } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  requirePrivateNotesDirectory,
  requireRunNotesId,
  requireNotesRoot,
} from "@/backend/service/agents/AgentRunNotesPath";

import type { AgentRunNotesContext } from "../AgentRunNotesContext";

/** Validates the capability again before mounting only this run into an empty temp area. */
export async function notesMounts(
  notes: AgentRunNotesContext | undefined,
  root: string | undefined,
): Promise<readonly string[]> {
  if (!notes) return [];
  if (!root || (await requireNotesRoot(root)) !== notes.root)
    throw new AgentError("plan_notes_path_invalid");
  const parts = path.relative(notes.root, notes.directory).split(path.sep);
  if (parts.length !== 2) throw new AgentError("plan_notes_path_invalid");
  for (const part of parts) requireRunNotesId(part);
  for (const directory of [
    notes.root,
    path.dirname(notes.directory),
    notes.directory,
  ])
    await requirePrivateNotesDirectory(directory);
  if ((await realpath(notes.directory)) !== notes.directory)
    throw new AgentError("plan_notes_path_invalid");
  return ["--bind", notes.directory, notes.directory];
}
