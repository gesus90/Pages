import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";

import {
  artifactDirectory,
  requireArtifactId,
  writeArtifact,
} from "./AgentArtifactPath";
import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";

function safeText(text: string): string {
  return sanitizePlanOutput(redactAssistantCredentials(text));
}

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
      return typeof entry === "string" ? safeText(entry) : entry;
    },
    2,
  );
  const heading = safeText(profile.name).replace(/\s+/gu, " ").trim();
  return `# ${heading}\n\nAgent-ID: ${profile.id}\n\n## Definition\n\n\`\`\`json\n${encoded}\n\`\`\`\n`;
}

/**
 * Owns the `AGENT.md` of every agent below the agent directory of the instance.
 *
 * @remarks
 * Only this class writes the file, and only from a persisted definition. While
 * a plan run holds an agent, no save or deletion of that agent is accepted.
 */
export class AgentDefinitionFiles {
  private readonly directory: string;
  private readonly holds = new Set<readonly string[]>();
  private readonly writes = new SerialQueue();

  public constructor(directory: string) {
    this.directory = directory;
  }

  /** Blocks management changes while any invocation holds this definition. */
  public assertMutable(id: string): void {
    requireArtifactId(id);
    for (const hold of this.holds)
      if (hold.includes(id)) throw new AgentError("profile_running");
  }

  /** Holds a definition immutable through adapter settlement and archive persistence. */
  public async hold(ids: readonly string[]): Promise<() => void> {
    return this.writes.run(async () => this.reserve(ids));
  }

  /** Serializes definition saves with reservations so an awaited database write cannot race a start. */
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
      await this.writeDefinition(persisted);
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
      try {
        await this.write(profile);
      } catch (error: unknown) {
        console.error(
          `Pages could not write the definition file of agent ${profile.id}.`,
          error,
        );
      }
    }
  }

  private reserve(ids: readonly string[]): () => void {
    for (const id of ids) requireArtifactId(id);
    const hold = [...ids];
    this.holds.add(hold);
    return () => {
      this.holds.delete(hold);
    };
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
