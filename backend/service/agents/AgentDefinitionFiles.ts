import { readFile } from "node:fs/promises";
import path from "node:path";

import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import {
  artifactDirectory,
  requireArtifactId,
  writeArtifact,
} from "./AgentArtifactPath";
import { sanitizeArtifactText } from "./AgentPlanOutput";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfile } from "@/definition/AgentProfile";
import type {
  AgentProfileJournal,
  AgentProfileRepository,
} from "@/backend/database/repositories/agent/AgentProfileRepository";

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

/** What a plan node reads from the `AGENT.md` of its agent. */
export interface AgentDefinitionDocument {
  readonly path: string;
  readonly agentId: string;
  readonly revision: number;
  readonly configuration: AgentConfiguration;
}

const DEFINITION_FENCE = "## Definition\n\n```json\n";

/**
 * Reads the definition back from the text {@link renderAgentDefinition} wrote.
 *
 * @throws {AgentError} `plan_definition_changed` for a text that holds no valid definition.
 */
function parseAgentDefinition(
  file: string,
  text: string,
): AgentDefinitionDocument {
  const start = text.indexOf(DEFINITION_FENCE);
  const end = text.lastIndexOf("\n```");
  if (start < 0 || end <= start)
    throw new AgentError("plan_definition_changed");
  try {
    const parsed: unknown = JSON.parse(
      text.slice(start + DEFINITION_FENCE.length, end),
    );
    const definition = readAgentObject(parsed);
    const revision = definition.revision ?? 1;
    if (
      typeof definition.agentId !== "string" ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision)
    )
      throw new AgentError("plan_definition_changed");
    return {
      path: file,
      agentId: definition.agentId,
      revision,
      configuration: readAgentConfiguration(definition.configuration),
    };
  } catch {
    throw new AgentError("plan_definition_changed");
  }
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
    return this.writes.run(async () => {
      await this.refresh(ids);
      return this.reserve(ids);
    });
  }

  /**
   * Reads the `AGENT.md` of an agent as a plan node starts.
   *
   * @param id - The agent of the node.
   * @returns The file path, the agent, its revision and its configuration.
   * @throws {AgentError} `plan_definition_changed` when the file is missing,
   * unreadable or names another agent.
   */
  public async read(id: string): Promise<AgentDefinitionDocument> {
    requireArtifactId(id);
    const file = path.join(this.directory, id, "AGENT.md");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      throw new AgentError("plan_definition_changed");
    }
    const document = parseAgentDefinition(file, text);
    if (document.agentId !== id)
      throw new AgentError("plan_definition_changed");
    return document;
  }

  /**
   * Serializes definition saves with reservations so an awaited database write cannot race a start.
   *
   * @param profile - The definition to store.
   * @param repository - Where the definition is persisted.
   * @param journal - Work that commits with the definition, in its transaction.
   *
   * @remarks
   * A problem with the file is reported and does not undo the saved
   * definition: the file is a copy, and the next save or start repairs it.
   * A journal that throws keeps the definition and the file as they were.
   */
  public async save(
    profile: AgentProfile,
    repository: AgentProfileRepository,
    journal?: AgentProfileJournal,
  ): Promise<void> {
    await this.writes.run(async () => {
      this.assertMutable(profile.id);
      await repository.save(profile, journal);
      const persisted = (await repository.list()).find(
        (entry) => entry.id === profile.id,
      );
      if (!persisted) throw new AgentError("profile_not_found");
      await this.writeOrReport(persisted);
    });
  }

  /** Serializes deletion with run reservations while retaining historical run records. */
  public async remove(
    id: string,
    repository: AgentProfileRepository,
  ): Promise<void> {
    await this.writes.run(async () => {
      this.assertMutable(id);
      await repository.remove(id);
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

  // A run reads the files, so they are brought up to date before it holds them.
  private async refresh(ids: readonly string[]): Promise<void> {
    if (this.loadProfiles === null) return;
    const profiles = await this.loadProfiles();
    for (const profile of profiles)
      if (ids.includes(profile.id) && !this.isHeld(profile.id))
        await this.writeOrReport(profile);
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
