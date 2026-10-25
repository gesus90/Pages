import { lstat } from "node:fs/promises";
import path from "node:path";

import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { TicketAssetAuditRepository } from "@/backend/database/repositories/task/TicketAssetAuditRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import {
  isTicketAssetPath,
  TicketFileStore,
} from "@/backend/storage/TicketFileStore";

import {
  ticketDescriptionAddress,
  ticketDescriptionReferences,
} from "./TicketDescriptionReferences";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredWorkItemAttachment } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import type {
  TicketAssetAudit,
  TicketAssetFinding,
} from "@/definition/TicketAssetAudit";

const FINDING_PRIORITY: Readonly<Record<TicketAssetFinding["reason"], number>> =
  {
    missingUpload: 0,
    missingAttachment: 0,
    missingFile: 0,
    missingUploadFile: 0,
    checksumMismatch: 0,
    expiredUpload: 1,
    temporaryUpload: 2,
    outsideTicketStorage: 3,
    externalImage: 3,
    legacyStorage: 4,
  };

/** Reports broken references without fetching remote addresses or changing any stored content. */
export class TicketAssetAuditService {
  private readonly tickets: TicketAssetAuditRepository;
  private readonly attachments: WorkItemAttachmentRepository;
  private readonly assets: AgentAssetRepository;
  private readonly files: TicketFileStore;
  private readonly directory: string;

  public constructor(database: DatabaseTransaction, directory: string) {
    this.tickets = new TicketAssetAuditRepository(database);
    this.attachments = new WorkItemAttachmentRepository(database);
    this.assets = new AgentAssetRepository(database);
    this.files = new TicketFileStore(directory);
    this.directory = directory;
  }

  /** Protects every persisted temporary-upload link, including file links and archived descriptions. */
  public async referencedUploadIds(): Promise<ReadonlySet<string>> {
    const ids = new Set<string>();
    for (const ticket of await this.tickets.tickets()) {
      for (const reference of ticketDescriptionReferences(ticket.description)) {
        const address = ticketDescriptionAddress(reference.url);
        if (address?.source === "agent") ids.add(address.id);
      }
    }
    return ids;
  }

  /** Reads all descriptions and verifies every attachment's bytes against its recorded checksum. */
  public async inspect(): Promise<TicketAssetAudit> {
    const tickets = await this.tickets.tickets();
    const attachments = await this.attachments.listAll();
    const byId = new Map(
      attachments.map((attachment) => [attachment.id, attachment]),
    );
    const findings: TicketAssetFinding[] = [];
    for (const ticket of tickets) {
      for (const reference of ticketDescriptionReferences(ticket.description)) {
        const reason = await this.referenceReason(reference, byId);
        if (reason)
          findings.push({
            ticketId: ticket.id,
            ticketKey: ticket.key,
            reference: reference.url,
            reason,
          });
      }
      for (const attachment of attachments.filter(
        (candidate) => candidate.workItemId === ticket.id,
      )) {
        const reason = await this.fileReason(attachment);
        if (reason)
          findings.push({
            ticketId: ticket.id,
            ticketKey: ticket.key,
            reference: `/aufgaben/attachments/${attachment.id}`,
            reason,
          });
      }
    }
    const unique = new Map(
      findings.map((finding) => [JSON.stringify(finding), finding]),
    );
    return {
      checkedAt: new Date().toISOString(),
      ticketCount: tickets.length,
      attachmentCount: attachments.length,
      findings: [...unique.values()].sort(
        (first, second) =>
          FINDING_PRIORITY[first.reason] - FINDING_PRIORITY[second.reason] ||
          first.ticketKey.localeCompare(second.ticketKey),
      ),
    };
  }

  private async referenceReason(
    reference: { readonly url: string; readonly isImage: boolean },
    attachments: ReadonlyMap<string, StoredWorkItemAttachment>,
  ): Promise<TicketAssetFinding["reason"] | null> {
    const address = ticketDescriptionAddress(reference.url);
    if (!address) return reference.isImage ? "externalImage" : null;
    if (address.source === "agent") return this.uploadReason(address.id);
    const attachment = attachments.get(address.id);
    if (!attachment) return "missingAttachment";
    return this.fileReason(attachment);
  }

  private async uploadReason(
    id: string,
  ): Promise<TicketAssetFinding["reason"]> {
    const asset = await this.assets.find(id);
    if (!asset) return "missingUpload";
    if (asset.status === "linked") return "outsideTicketStorage";
    try {
      const file = await lstat(
        path.join(
          this.directory,
          "agent-assets",
          path.basename(asset.storageName),
        ),
      );
      if (!file.isFile() || file.size !== asset.size)
        return "missingUploadFile";
    } catch {
      return "missingUploadFile";
    }
    return asset.status !== "staged" || asset.expiresAt <= Date.now()
      ? "expiredUpload"
      : "temporaryUpload";
  }

  private async fileReason(
    attachment: StoredWorkItemAttachment,
  ): Promise<TicketAssetFinding["reason"] | null> {
    try {
      const file = await this.files.inspect(attachment.storageName);
      if (
        file.size !== attachment.size ||
        file.checksum !== attachment.checksum
      )
        return "checksumMismatch";
      return isTicketAssetPath(attachment.storageName) ? null : "legacyStorage";
    } catch {
      return "missingFile";
    }
  }
}
