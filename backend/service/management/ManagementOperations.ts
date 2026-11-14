import {
  MANAGEMENT_READ_OPERATIONS,
  MANAGEMENT_WRITE_OPERATIONS,
} from "@/definition/Management";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { ManagementService } from "./ManagementService";

/** Connects the same services used by HTTP and the UI to the internal Pages tool router. */
export class ManagementOperations {
  private readonly channel: ActorChannel;
  private readonly service: () => ManagementService;
  /** Defers service resolution until employee services are assembled. */
  public constructor(
    service: () => ManagementService,
    channel: ActorChannel = "mcp",
  ) {
    this.channel = channel;
    this.service = service;
  }
  /** Carries the audit actor for every existing tool as well as the new tools. */
  public async audited<Result>(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
    work: () => Promise<Result>,
  ): Promise<Result> {
    const target =
      typeof input === "object" && input !== null
        ? String(
            Reflect.get(input, "ticketId") ??
              Reflect.get(input, "planId") ??
              Reflect.get(input, "userId") ??
              Reflect.get(input, "pageId") ??
              "directory",
          )
        : "directory";
    return this.service().audit.run(
      identity.userId,
      String(operation),
      target,
      work,
    );
  }
  /** Supplies the revision of an already authorized project read. */
  public async projectRevision(
    identity: AgentIdentity,
    projectId: string,
  ): Promise<string | undefined> {
    if (!identity.isAdmin && !identity.isManagement) return undefined;
    return this.service().projectRevision(
      identity.userId,
      projectId,
      this.channel,
    );
  }
  /** Handles the named contract and companion group-read tools; every other operation is left to its owner. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | null> {
    const known = [
      ...MANAGEMENT_READ_OPERATIONS,
      ...MANAGEMENT_WRITE_OPERATIONS,
    ].find((name) => name === operation);
    if (!known) return null;
    return {
      apiVersion: "1",
      result: await this.service().call(
        identity.userId,
        known,
        input,
        this.channel,
      ),
    };
  }
}
