import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type {
  AgentWikiCreated,
  AgentWikiCreateInput,
} from "@/definition/PagesAgentWrites";

/** Compares stable input fingerprints and saves replay results in a caller-owned transaction. */
export class AgentOperationKeyService {
  private readonly repository: AgentOperationKeyRepository;

  public constructor(repository: AgentOperationKeyRepository) {
    this.repository = repository;
  }

  /** Returns a stored result or rejects reuse with changed input. */
  public async replay(
    userId: string,
    input: AgentWikiCreateInput,
  ): Promise<AgentWikiCreated | null> {
    const previous = await this.repository.find(userId, input.operationId);
    if (!previous) return null;
    if (
      previous.operation !== "wiki.page.create" ||
      previous.fingerprint !== this.fingerprint(input)
    )
      throw new AgentOperationError("CONFLICT");
    // This JSON is written exclusively by save, within the same schema and transaction.
    return JSON.parse(previous.resultJson) as AgentWikiCreated;
  }

  /** Persists the exact result before the shared transaction commits. */
  public async save(
    userId: string,
    input: AgentWikiCreateInput,
    result: AgentWikiCreated,
  ): Promise<void> {
    await this.repository.insert(userId, input.operationId, {
      operation: "wiki.page.create",
      fingerprint: this.fingerprint(input),
      resultJson: JSON.stringify(result),
    });
  }

  private fingerprint(input: AgentWikiCreateInput): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }
}
