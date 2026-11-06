import { createHash, randomUUID } from "node:crypto";

import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";

/** In-memory immutable payload boundary for repository/engine unit fixtures. */
export class MemoryAgentPayloads extends AgentPayloadFileStore {
  private readonly contents = new Map<string, string>();

  public constructor() {
    super("/synthetic/payloads");
  }

  /** Retains bytes under a unique reference without touching the filesystem. */
  public override async write(
    planId: string,
    contents: string,
  ): Promise<string> {
    const planKey = createHash("sha256").update(planId).digest("hex");
    const filePath = `agent-payloads/${planKey}/${randomUUID()}.payload`;
    this.contents.set(filePath, contents);
    return JSON.stringify({
      version: 1,
      path: filePath,
      size: Buffer.byteLength(contents),
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }

  /** Resolves a saved reference, including the repository's additional workspace metadata. */
  public override async read(serialized: string): Promise<string> {
    const reference: unknown = JSON.parse(serialized);
    if (
      typeof reference !== "object" ||
      reference === null ||
      !("path" in reference) ||
      typeof reference.path !== "string"
    )
      throw new Error("Invalid synthetic payload reference");
    const contents = this.contents.get(reference.path);
    if (contents === undefined) throw new Error("Missing synthetic payload");
    return contents;
  }
}
