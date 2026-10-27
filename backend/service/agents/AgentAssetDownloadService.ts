import { agentAssetRepresentation } from "@/definition/AgentTicketParameter";
import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { ticketAssetReference } from "./AgentTicketAssetReferences";

import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentAssetDownload } from "@/definition/AgentAssetTransfer";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";
import type { AgentTicketAssetService } from "./AgentTicketAssetService";

interface DownloadAuthority {
  readonly userId: string;
  readonly hash: string;
  readonly asset: AgentTicketAsset;
  readonly digest: string;
  readonly expiresAt: number;
}

/** Short-lived original downloads; each read rechecks the credential, file policy and pinned digest. */
export class AgentAssetDownloadService {
  private readonly tickets = new Map<string, DownloadAuthority>();
  private readonly dependencies: {
    readonly users: Pick<UserService, "getById">;
    readonly assets: AgentTicketAssetService;
    readonly verify: (hash: string) => Promise<AgentIdentity>;
  };

  public constructor(dependencies: AgentAssetDownloadService["dependencies"]) {
    this.dependencies = dependencies;
  }

  /** Accepts only canonical Pages attachment links, never a local path or external URL. */
  public async prepare(
    identity: AgentIdentity,
    token: string,
    input: unknown,
  ): Promise<AgentAssetDownload> {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "link")
    )
      throw new AgentOperationError("INVALID_REQUEST");
    const link: unknown = Reflect.get(input, "link");
    const asset =
      typeof link === "string" && link.startsWith("/")
        ? ticketAssetReference(link)
        : null;
    if (!asset || asset.link !== link)
      throw new AgentOperationError("INVALID_REQUEST");
    const file = await this.read(identity, asset);
    for (const [hash, authority] of this.tickets)
      if (authority.expiresAt <= Date.now()) this.tickets.delete(hash);
    const ticket = createAgentCredential();
    const expiresAt = Date.now() + 300_000;
    this.tickets.set(hashAgentCredential(ticket), {
      userId: identity.userId,
      hash: hashAgentCredential(token),
      asset,
      digest: file.original.digest,
      expiresAt,
    });
    return {
      ticket,
      expiresAt,
      asset,
      header: "X-Pages-Download-Ticket",
      downloadPath: "/api/v1/agent-assets",
      fileName: file.fileName,
      contentType: file.original.mimeType,
      size: file.size,
      digest: file.original.digest,
      representation: agentAssetRepresentation(file.content),
      modelContent:
        file.content.type === "file"
          ? file.content.reason
          : "available-through-file-tool; not-yet-viewed",
    };
  }

  /** Consumes before reading; a revoked owner, lost run or changed original cannot reuse the capability. */
  public async consume(
    ticket: string,
  ): Promise<Awaited<ReturnType<AgentTicketAssetService["read"]>>> {
    const hash = hashAgentCredential(ticket);
    const authority = this.tickets.get(hash);
    this.tickets.delete(hash);
    if (!authority || authority.expiresAt <= Date.now())
      throw new AgentOperationError("NOT_FOUND");
    const identity = await this.dependencies.verify(authority.hash);
    if (identity.userId !== authority.userId)
      throw new AgentOperationError("FORBIDDEN");
    const file = await this.read(identity, authority.asset);
    if (file.original.digest !== authority.digest)
      throw new AgentOperationError("CONFLICT");
    return file;
  }

  private async read(
    identity: AgentIdentity,
    asset: AgentTicketAsset,
  ): Promise<Awaited<ReturnType<AgentTicketAssetService["read"]>>> {
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new AgentOperationError("FORBIDDEN");
    try {
      return await this.dependencies.assets.read(actor, asset);
    } catch {
      throw new AgentOperationError("NOT_FOUND");
    }
  }
}
