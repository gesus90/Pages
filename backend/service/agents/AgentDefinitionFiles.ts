import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";

import {
  agentArtifactRoot,
  artifactDirectory,
  requireArtifactId,
} from "./AgentArtifactPath";
import { sanitizePlanOutput } from "./AgentPlanOutput";

import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";

/** Server-owned definitions live outside web and workspace roots; CLI isolation hides this directory. */
export class AgentDefinitionFiles {
  private readonly dataDirectory: string;
  private readonly running = new Map<string, number>();
  private readonly writes = new SerialQueue();

  public constructor(dataDirectory: string) {
    this.dataDirectory = dataDirectory;
  }

  /** Blocks management changes while any invocation holds this definition. */
  public async assertMutable(id: string): Promise<void> {
    requireArtifactId(id);
    if (this.running.has(id)) throw new AgentError("profile_conflict");
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
      await this.assertMutable(profile.id);
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
      await this.assertMutable(profile.id);
      await this.writeDefinition(profile);
    });
  }

  private reserve(ids: readonly string[]): () => void {
    for (const id of ids) requireArtifactId(id);
    for (const id of ids) this.running.set(id, (this.running.get(id) ?? 0) + 1);
    let isReleased = false;
    return () => {
      if (isReleased) return;
      isReleased = true;
      for (const id of ids) {
        const count = (this.running.get(id) ?? 1) - 1;
        if (count === 0) this.running.delete(id);
        else this.running.set(id, count);
      }
    };
  }

  private async writeDefinition(profile: AgentProfile): Promise<void> {
    const root = await agentArtifactRoot(this.dataDirectory);
    const directory = await artifactDirectory(root, [profile.id]);
    const temporary = path.join(directory, `${randomUUID()}.md`);
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
        return typeof entry === "string"
          ? sanitizePlanOutput(redactAssistantCredentials(entry))
          : entry;
      },
      2,
    );
    const markdown = `# ${sanitizePlanOutput(profile.name)}\n\nAgent-ID: ${profile.id}\n\n## Definition\n\n\`\`\`json\n${encoded}\n\`\`\`\n`;
    try {
      await writeFile(temporary, markdown, { flag: "wx", mode: 0o400 });
      await rename(temporary, path.join(directory, "AGENT.md"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
