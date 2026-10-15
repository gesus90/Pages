import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { scanAgentPlaceholders } from "@/definition/AgentParameters";
import { isApiProvider } from "@/definition/AgentConnection";

import {
  ensurePrivateNotesDirectory,
  overlapsWorkspacePath,
  requirePrivateNotesDirectory,
  requireRunNotesId,
  requireNotesRoot,
} from "./AgentRunNotesPath";
import { canonicalProspectivePath } from "./AgentCanonicalPath";
import { isMissingPath } from "./AgentCanonicalPath";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentRunNotesContext } from "@/backend/agents/AgentRunNotesContext";
import type { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** A terminal view alone cannot prove that a model's processes have exited. */
export function hasSettledNotesProcesses(run: AgentPlanRun): boolean {
  return (
    run.status !== "running" &&
    run.status !== "paused" &&
    run.steps.every(
      (step) =>
        step.status !== "running" &&
        step.status !== "paused" &&
        (!step.session ||
          step.session.mode === "request" ||
          step.session.closeout === "confirmed" ||
          (step.session.closeout === "not_needed" &&
            step.session.startedAt === null &&
            step.session.processId === null)),
    )
  );
}

/** Manages ephemeral notes only; it never reads their contents or sends them to the archive. */
export class AgentRunNotes {
  private readonly root: string;
  private readonly isolation: Pick<CliPlanIsolation, "isAvailable"> &
    Partial<Pick<CliPlanIsolation, "notesDirectories">>;

  public constructor(
    root: string,
    isolation: Pick<CliPlanIsolation, "isAvailable"> &
      Partial<Pick<CliPlanIsolation, "notesDirectories">>,
  ) {
    this.root = root;
    this.isolation = isolation;
  }

  /** Completes availability and path checks without creating anything. */
  public async validate(snapshot: AgentPlanSnapshot): Promise<boolean> {
    const isAvailable =
      snapshot.steps.some((step) => !isApiProvider(step.provider)) &&
      (await this.isolation.isAvailable({ refresh: true }));
    for (const step of snapshot.steps) {
      const usesNotes = [step.template.markdown, step.step.instruction].some(
        (markdown) => scanAgentPlaceholders(markdown).builtins.length > 0,
      );
      if (usesNotes && (isApiProvider(step.provider) || !isAvailable))
        throw new AgentPlanValidationError([
          {
            nodeId: step.step.id,
            port: null,
            reason: isApiProvider(step.provider)
              ? "notesApi"
              : "notesUnavailable",
          },
        ]);
    }
    const root = await canonicalProspectivePath(this.root);
    const protectedDirectories = [
      root,
      ...(isAvailable
        ? ((await this.isolation.notesDirectories?.()) ?? [])
        : []),
    ];
    for (const step of snapshot.steps) {
      for (const directory of [
        step.prepared.workspace,
        ...(step.prepared.directory ? [step.prepared.directory] : []),
        ...step.prepared.references,
      ]) {
        const canonical = await realpath(directory.path);
        if (
          protectedDirectories.some((entry) =>
            overlapsWorkspacePath(entry, canonical),
          )
        )
          throw new AgentError("plan_notes_path_invalid");
      }
    }
    return isAvailable;
  }

  /** Creates exactly one new directory after validation, with one private file per CLI node. */
  public async create(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
  ): Promise<AgentRunNotesContext | null> {
    if (!(await this.validate(snapshot))) return null;
    requireRunNotesId(run.planId);
    requireRunNotesId(run.id);
    for (const step of snapshot.steps) requireRunNotesId(step.step.id);
    // The fixed .pages parent may be readable, but must not redirect or permit foreign writes.
    const parent = path.dirname(this.root);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const metadata = await lstat(parent);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o022) !== 0
    )
      throw new AgentError("plan_notes_path_invalid");
    await ensurePrivateNotesDirectory(this.root);
    const root = await realpath(this.root);
    const planDirectory = path.join(root, run.planId);
    await ensurePrivateNotesDirectory(planDirectory);
    const directory = path.join(planDirectory, run.id);
    // No recursive/exist-ok creation here: a pre-existing run must never be taken over.
    await mkdir(directory, { mode: 0o700 });
    const context = { root, directory };
    try {
      for (const step of snapshot.steps.filter(
        (entry) => !isApiProvider(entry.provider),
      ))
        await writeFile(path.join(directory, `${step.step.id}.md`), "", {
          flag: "wx",
          mode: 0o600,
        });
      return context;
    } catch (error: unknown) {
      await this.discard(context);
      throw error;
    }
  }

  /** Removes a failed start before any process existed, or a run with confirmed closeouts. */
  public async discard(context: AgentRunNotesContext): Promise<void> {
    await requireNotesRoot(this.root);
    await requirePrivateNotesDirectory(context.root);
    await requirePrivateNotesDirectory(path.dirname(context.directory));
    await requirePrivateNotesDirectory(context.directory);
    const root = await realpath(this.root);
    if (
      context.root !== root ||
      !context.directory.startsWith(`${root}${path.sep}`) ||
      path.relative(root, context.directory).split(path.sep).length !== 2
    )
      throw new AgentError("plan_notes_path_invalid");
    // rm unlinks nested symlinks; it never traverses their targets.
    await rm(context.directory, { recursive: true });
    await rm(`${context.directory}.paused`, { force: true });
  }

  /** Keeps pause evidence outside the CLI mount, including across existing restart recovery. */
  public async setPaused(
    context: AgentRunNotesContext,
    state: { readonly isPaused: boolean },
  ): Promise<void> {
    await requireNotesRoot(this.root);
    await requirePrivateNotesDirectory(path.dirname(context.directory));
    const marker = `${context.directory}.paused`;
    if (!state.isPaused) {
      await rm(marker, { force: true });
      return;
    }
    try {
      await writeFile(marker, "", { flag: "wx", mode: 0o600 });
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
      const entry = await lstat(marker);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        entry.uid !== process.getuid?.() ||
        (entry.mode & 0o077) !== 0
      )
        throw new AgentError("plan_notes_path_invalid");
    }
  }

  /** A persisted pause stays protected even when legacy startup recovery changes the run status. */
  public async isPaused(directory: string): Promise<boolean> {
    try {
      await lstat(`${directory}.paused`);
      return true;
    } catch (error: unknown) {
      if (isMissingPath(error)) return false;
      throw error;
    }
  }

  /** Keeps notes when process closeout is uncertain; a later bounded cleanup can retry. */
  public async complete(
    run: AgentPlanRun,
    context: AgentRunNotesContext,
  ): Promise<void> {
    if (!hasSettledNotesProcesses(run)) return;
    try {
      await this.discard(context);
    } catch (error: unknown) {
      console.error("Pages could not remove completed run notes.", error);
    }
  }
}
