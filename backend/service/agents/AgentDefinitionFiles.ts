import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import {
  artifactDirectory,
  requireArtifactId,
  writeArtifact,
} from "./AgentArtifactPath";
import { sanitizeArtifactText } from "./AgentPlanOutput";

import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";

/**
 * Renders the stored definition of an agent as its `AGENT.md`.
 *
 * @param profile - Persisted definition; connection and credentials are not part of it.
 * @returns A heading, the agent identifier and the definition as one JSON block.
 */
export function renderAgentDefinition(profile: AgentProfile): string {
  const definition = {
    agentId: profile.id,
    name: profile.name,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
    revision: profile.revision,
    configuration: profile.configuration,
  };
  const encoded = JSON.stringify(
    definition,
    (property: string, entry: unknown): unknown => {
      if (property === "") return entry;
      return typeof entry === "string" ? sanitizeArtifactText(entry) : entry;
    },
    2,
  );
  const heading = sanitizeArtifactText(profile.name)
    .replace(/\s+/gu, " ")
    .trim();
  return `# ${heading}\n\nAgent-ID: ${profile.id}\n\n## Definition\n\n\`\`\`json\n${encoded}\n\`\`\`\n`;
}

/**
 * Owns the `AGENT.md` of every agent below the agent directory of the instance.
 *
 * @remarks
 * Only this class writes the file, and only from a persisted definition. While
 * a plan run holds an agent, no save or deletion of that agent is accepted.
 * When the run lets go, the file is checked against the stored definition, so
 * a changed or lost file is back before the next run can read it.
 */
export class AgentDefinitionFiles {
  private readonly directory: string;
  private readonly loadProfiles:
    (() => Promise<readonly AgentProfile[]>) | null;
  private readonly holds = new Set<readonly string[]>();
  private readonly writes = new SerialQueue();

  /**
   * Creates the owner of the definition files.
   *
   * @param directory - The agent directory of the instance.
   * @param loadProfiles - Supplies the stored definitions for the check after a
   * run; without it a run is not followed by a check.
   */
  public constructor(
    directory: string,
    loadProfiles?: () => Promise<readonly AgentProfile[]>,
  ) {
    this.directory = directory;
    this.loadProfiles = loadProfiles ?? null;
  }

  /** Blocks management changes while any invocation holds this definition. */
  public assertMutable(id: string): void {
    requireArtifactId(id);
    if (this.isHeld(id)) throw new AgentError("profile_running");
  }

  /**
   * Holds definitions immutable through adapter settlement and archive persistence.
   *
   * @returns The release, which also checks the held files against the stored
   * definitions; calling it again does nothing.
   */
  public async hold(ids: readonly string[]): Promise<() => Promise<void>> {
    return this.writes.run(async () => this.reserve(ids));
  }

  /**
   * Serializes definition saves with reservations so an awaited database write cannot race a start.
   *
   * @remarks
   * A problem with the file is reported and does not undo the saved
   * definition: the file is a copy, and the next save or start repairs it.
   */
  public async save(
    profile: AgentProfile,
    repository: AgentProfileRepository,
  ): Promise<void> {
    await this.writes.run(async () => {
      this.assertMutable(profile.id);
      await repository.save(profile);
      const persisted = (await repository.list()).find(
        (entry) => entry.id === profile.id,
      );
      if (!persisted) throw new AgentError("profile_not_found");
      await this.writeOrReport(persisted);
    });
  }

  /** Atomically materializes a secret-free definition from persisted fields only. */
  public async write(profile: AgentProfile): Promise<void> {
    await this.writes.run(async () => {
      this.assertMutable(profile.id);
      await this.writeDefinition(profile);
    });
  }

  /**
   * Repairs missing or altered files from the stored definitions.
   *
   * @param profiles - Every persisted definition.
   *
   * @remarks
   * Runs at startup, so an unwritable folder is reported and skipped instead of
   * keeping the whole server from starting. The next save repairs that agent.
   */
  public async restore(profiles: readonly AgentProfile[]): Promise<void> {
    for (const profile of profiles) {
      await this.writes.run(async () => {
        if (this.isHeld(profile.id)) return;
        await this.writeOrReport(profile);
      });
    }
  }

  private isHeld(id: string): boolean {
    return [...this.holds].some((hold) => hold.includes(id));
  }

  private reserve(ids: readonly string[]): () => Promise<void> {
    for (const id of ids) requireArtifactId(id);
    const hold = [...ids];
    this.holds.add(hold);
    return async () => {
      if (!this.holds.delete(hold)) return;
      await this.repair(ids);
    };
  }

  private async repair(ids: readonly string[]): Promise<void> {
    if (this.loadProfiles === null) return;
    try {
      const profiles = await this.loadProfiles();
      await this.restore(profiles.filter((entry) => ids.includes(entry.id)));
    } catch (error: unknown) {
      console.error(
        "Pages could not check the definition files after a run.",
        error,
      );
    }
  }

  private async writeOrReport(profile: AgentProfile): Promise<void> {
    try {
      await this.writeDefinition(profile);
    } catch (error: unknown) {
      console.error(
        `Pages could not write the definition file of agent ${profile.id}.`,
        error,
      );
    }
  }

  private async writeDefinition(profile: AgentProfile): Promise<void> {
    // A model assignment for the text or chat function is no agent a plan can run.
    if (!profile.purposes.includes("agent")) return;
    const directory = await artifactDirectory(this.directory, [profile.id]);
    await writeArtifact(
      path.join(directory, "AGENT.md"),
      renderAgentDefinition(profile),
    );
  }
}
