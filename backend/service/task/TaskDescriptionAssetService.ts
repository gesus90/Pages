import { randomUUID } from "node:crypto";
import path from "node:path";

import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemWriteRepository } from "@/backend/database/repositories/task/WorkItemWriteRepository";
import { TicketAssetAuditRepository } from "@/backend/database/repositories/task/TicketAssetAuditRepository";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import {
  rewriteTicketDescription,
  ticketDescriptionAddress,
  ticketDescriptionReferences,
} from "./TicketDescriptionReferences";
import { validateDescription } from "./WorkItemValidation";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { StoredAgentAsset } from "@/backend/database/repositories/agents/AgentAssetRepository";
import type { TicketDescriptionReference } from "./TicketDescriptionReferences";
import type { User } from "@/definition/User";

interface DescriptionWrite {
  readonly actor: User;
  readonly ticketId: string;
  readonly description: string;
  readonly authorizeTicket?: (ticketId: string) => Promise<void>;
}

/** Refuses external images even when a caller has no file-storage context. */
export function validateTicketDescriptionSources(description: string): void {
  for (const reference of ticketDescriptionReferences(description)) {
    if (reference.isImage && !ticketDescriptionAddress(reference.url))
      throw new WorkItemValidationError("attachmentUploadRequired");
    if (/^file:/i.test(reference.url))
      throw new WorkItemValidationError("attachmentUploadRequired");
  }
}

/** Promotes owned uploads in the same database commit as the ticket text, preserving rollback originals. */
export class TaskDescriptionAssetService {
  private readonly database: TaskDatabase;
  private readonly files: TicketFileStore;
  private readonly staging: WikiFileStore;

  public constructor(database: TaskDatabase, directory: string) {
    this.database = database;
    this.files = new TicketFileStore(directory);
    this.staging = new WikiFileStore(path.join(directory, "agent-assets"));
  }

  /** Persists attachments and rewritten text together; a later outer rollback restores the staged state. */
  public async save<Result>(
    input: DescriptionWrite,
    work: (
      repository: WorkItemWriteRepository,
      description: string,
    ) => Promise<Result>,
  ): Promise<Result> {
    validateTicketDescriptionSources(input.description);
    // UI permission reads share the connection, so they must finish before its write transaction starts.
    const readableAttachments = await this.authorizeAttachments(input);
    return this.database.transaction(async (transaction) => {
      const references = ticketDescriptionReferences(input.description);
      const replacements = new Map<TicketDescriptionReference, string>();
      const promoted = new Map<string, string>();
      for (const reference of references) {
        const address = ticketDescriptionAddress(reference.url);
        if (!address) continue;
        if (address.source === "ticket") {
          await this.requireAttachment(
            transaction,
            input.ticketId,
            address.id,
            readableAttachments,
          );
          continue;
        }
        let link = promoted.get(address.id);
        if (!link) {
          link = await this.promote(transaction, input, address.id);
          promoted.set(address.id, link);
        }
        replacements.set(reference, link);
      }
      const description = rewriteTicketDescription(
        input.description,
        replacements,
      );
      validateDescription(description);
      return work(
        new WorkItemWriteRepository(agentTransactionScope(transaction)),
        description,
      );
    });
  }

  private async requireAttachment(
    transaction: DatabaseTransaction,
    ticketId: string,
    id: string,
    readableAttachments: ReadonlyMap<string, string>,
  ): Promise<void> {
    const attachment = await new WorkItemAttachmentRepository(transaction).find(
      id,
    );
    if (
      !attachment ||
      (attachment.workItemId !== ticketId &&
        readableAttachments.get(id) !== attachment.workItemId)
    )
      throw new WorkItemValidationError("attachmentUnavailable");
    try {
      await this.files.requireFile(attachment.storageName);
    } catch {
      throw new WorkItemValidationError("attachmentUnavailable");
    }
  }

  private async authorizeAttachments(
    input: DescriptionWrite,
  ): Promise<ReadonlyMap<string, string>> {
    const readable = new Map<string, string>();
    const repository = new WorkItemAttachmentRepository(this.database);
    for (const reference of ticketDescriptionReferences(input.description)) {
      const address = ticketDescriptionAddress(reference.url);
      if (address?.source !== "ticket" || readable.has(address.id)) continue;
      const attachment = await repository.find(address.id);
      if (!attachment || attachment.workItemId === input.ticketId) continue;
      if (!input.authorizeTicket)
        throw new WorkItemValidationError("attachmentUnavailable");
      try {
        await input.authorizeTicket(attachment.workItemId);
      } catch {
        throw new WorkItemValidationError("attachmentUnavailable");
      }
      readable.set(address.id, attachment.workItemId);
    }
    return readable;
  }

  private async promote(
    transaction: DatabaseTransaction,
    input: DescriptionWrite,
    id: string,
  ): Promise<string> {
    const assets = new AgentAssetRepository(transaction);
    const asset = await assets.find(id);
    if (
      !asset ||
      asset.userId !== input.actor.id ||
      asset.status !== "staged" ||
      asset.expiresAt <= Date.now()
    )
      throw new WorkItemValidationError("attachmentUploadUnavailable");
    if (!transaction.onCommit || !transaction.onRollback)
      throw new Error(
        "Ticket upload promotion requires transaction file effects.",
      );
    const attachmentId = randomUUID();
    const stored = await this.copyUpload(input.ticketId, attachmentId, asset);
    transaction.onRollback(() => this.files.remove([stored.storageName]));
    await new WorkItemAttachmentRepository(transaction).insert(
      {
        workItemId: input.ticketId,
        fileName: asset.fileName,
        contentType: stored.type.contentType,
        kind: stored.type.kind,
        size: stored.size,
        checksum: stored.checksum,
        storageName: stored.storageName,
        uploadedBy: input.actor.id,
      },
      attachmentId,
    );
    if (
      !(await this.isReferencedElsewhere(transaction, input.ticketId, asset.id))
    ) {
      await assets.remove(asset.id);
      transaction.onCommit(() => this.staging.remove([asset.storageName]));
    }
    return `/aufgaben/attachments/${attachmentId}`;
  }

  private async isReferencedElsewhere(
    transaction: DatabaseTransaction,
    ticketId: string,
    assetId: string,
  ): Promise<boolean> {
    const tickets = await new TicketAssetAuditRepository(transaction).tickets();
    return tickets.some(
      (ticket) =>
        ticket.id !== ticketId &&
        ticketDescriptionReferences(ticket.description).some((reference) => {
          const address = ticketDescriptionAddress(reference.url);
          return address?.source === "agent" && address.id === assetId;
        }),
    );
  }

  private async copyUpload(
    ticketId: string,
    attachmentId: string,
    asset: StoredAgentAsset,
  ): Promise<Awaited<ReturnType<TicketFileStore["write"]>>> {
    try {
      const stored = await this.files.write(
        { ticketId, attachmentId },
        this.staging.open(asset.storageName),
        {
          absoluteLimit: asset.size,
          limitFor: () => asset.size,
        },
      );
      if (stored.checksum !== asset.checksum || stored.size !== asset.size) {
        await this.files.remove([stored.storageName]);
        throw new WorkItemValidationError("attachmentUploadUnavailable");
      }
      return stored;
    } catch (error: unknown) {
      if (error instanceof WorkItemValidationError) throw error;
      throw new WorkItemValidationError("attachmentUploadUnavailable");
    }
  }
}
