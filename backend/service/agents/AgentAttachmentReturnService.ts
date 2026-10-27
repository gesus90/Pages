import { createHash } from "node:crypto";

import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentAssetRevisionRepository } from "@/backend/database/repositories/agents/AgentAssetRevisionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { assetReturnSources } from "./AgentAssetReturnSources";
import { assetRepresentation } from "./AgentAssetRepresentations";
import { attachmentReturnTarget } from "./AgentAttachmentReturnTarget";
import { MAX_TICKET_ASSET_BYTES } from "./AgentTicketAssetService";

import type { AgentTicketAssetService } from "./AgentTicketAssetService";
import type { User } from "@/definition/User";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";
import type {
  AttachmentReturnTarget,
  AttachmentReturnDestination,
} from "./AgentAttachmentReturnTarget";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { UploadedFile } from "@/backend/service/WikiService";
import type { UploadLimitSource } from "@/backend/service/task/TaskAttachmentService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentAssetReturn } from "@/definition/AgentAssetTransfer";
import type { AgentAsset } from "@/definition/PagesAgentWrites";

/** Server-owned credential binding added after consuming a binary upload capability. */
export interface AuthorizedAssetReturn extends AgentAssetReturn {
  readonly credentialHash: string;
}

interface AttachmentReturnInput {
  readonly destination: AttachmentReturnDestination;
  readonly request: AuthorizedAssetReturn;
  readonly fileName: string;
  readonly bytes: Buffer;
  readonly digest: string;
}

/** Commits a new immutable attachment, optional replacement selection and replay result together. */
export class AgentAttachmentReturnService {
  private readonly dependencies: {
    readonly database: Pick<Database, "transaction">;
    readonly directory: string;
    readonly limits: UploadLimitSource;
  };

  public constructor(
    dependencies: AgentAttachmentReturnService["dependencies"],
  ) {
    this.dependencies = dependencies;
  }

  /** Buffers only bounded output; response-loss replays never publish an additional attachment. */
  public async upload(
    file: UploadedFile,
    revalidate: () => Promise<AgentIdentity>,
    target: string | AttachmentReturnDestination,
    request: AuthorizedAssetReturn,
  ): Promise<AgentAsset> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.body) {
      size += chunk.byteLength;
      if (size > MAX_TICKET_ASSET_BYTES)
        throw new AgentOperationError("PAYLOAD_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    await requireOutput(bytes);
    const identity = await revalidate();
    if (
      (identity.run && identity.run.reach !== "full") ||
      (!identity.isAdmin && !identity.permissions.includes("write"))
    )
      throw new AgentOperationError("FORBIDDEN");
    const input = {
      destination:
        typeof target === "string"
          ? { type: "ticket" as const, id: target }
          : target,
      request,
      fileName: file.fileName,
      bytes,
      digest: createHash("sha256").update(bytes).digest("hex"),
    };
    // Settings are read before entering the serialized transaction, avoiding a nested main-connection read.
    const settings = await this.dependencies.limits.getSettings();
    return this.dependencies.database.transaction((transaction) =>
      this.publish(identity, input, { transaction, settings }),
    );
  }

  private async publish(
    identity: AgentIdentity,
    input: AttachmentReturnInput,
    context: {
      readonly transaction: DatabaseTransaction;
      readonly settings: Awaited<ReturnType<UploadLimitSource["getSettings"]>>;
    },
  ): Promise<AgentAsset> {
    const { transaction, settings } = context;
    const scope: TaskDatabase = {
      ...transaction,
      transaction: async (operation) => operation(transaction),
    };
    const actor = await new UserRepository(scope).findById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new AgentOperationError("FORBIDDEN");
    await requireCredential(identity, input.request, scope);
    const target = attachmentReturnTarget({
      scope,
      actor,
      directory: this.dependencies.directory,
      limits: { getSettings: async () => settings },
      destination: input.destination,
    });
    await target.authorize();
    const keys = new AgentOperationKeyRepository(transaction);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          ...input,
          request: { ...input.request, credentialHash: undefined },
          bytes: undefined,
        }),
      )
      .digest("hex");
    const previous = await keys.find(actor.id, input.request.operationId);
    if (previous) {
      if (
        previous.operation !== "assets.return" ||
        previous.fingerprint !== fingerprint
      )
        throw new AgentOperationError("CONFLICT");
      const result = readResult(previous.resultJson);
      const storedResult = await target.find(result.assetId);
      if (!storedResult) throw new AgentOperationError("NOT_FOUND");
      if (
        result.digest &&
        (await target.digest(storedResult.storageName)) !== result.digest
      )
        throw new AgentOperationError("CONFLICT");
      return result;
    }
    await this.requireSource(target, input, { transaction, scope, actor });
    const attachment = await target.upload({
      fileName: input.fileName,
      body: (async function* () {
        yield input.bytes;
      })(),
      contentLength: input.bytes.length,
    });
    const stored = await target.find(attachment.assetId);
    if (stored)
      transaction.onRollback?.(() => target.remove([stored.storageName]));
    if (shouldReplace(input.request))
      await new AgentAssetRevisionRepository(transaction).insert(
        input.request.sourceAttachmentId,
        attachment.assetId,
        input.request.expectedDigest,
        input.destination.type,
      );
    const result = assetReturnResult(attachment, input);
    await keys.insert(actor.id, input.request.operationId, {
      operation: "assets.return",
      fingerprint,
      resultJson: JSON.stringify(result),
    });
    return result;
  }

  private async requireSource(
    target: AttachmentReturnTarget,
    input: AttachmentReturnInput,
    context: {
      readonly transaction: DatabaseTransaction;
      readonly scope: TaskDatabase;
      readonly actor: User;
    },
  ): Promise<void> {
    const sourceId = input.request.sourceAttachmentId;
    if (!sourceId) return;
    const reference = sourceReference(input, sourceId);
    const source =
      reference.source === input.destination.type
        ? await target.find(sourceId)
        : null;
    if (!source || source.ownerId !== input.destination.id) {
      if (input.request.replace) throw new AgentOperationError("NOT_FOUND");
      const original = await readSourceOrigin({
        scope: context.scope,
        directory: this.dependencies.directory,
        actor: context.actor,
        reference,
      });
      requireSourceDigest(original.original.digest, input);
      return;
    }
    if (
      input.request.replace &&
      (await new AgentAssetRevisionRepository(context.transaction).isReplaced(
        sourceId,
        input.destination.type,
      ))
    )
      throw new AgentOperationError("CONFLICT");
    if (source.checksum !== input.request.expectedDigest)
      throw new AgentOperationError("CONFLICT");
    requireSourceDigest(await target.digest(source.storageName), input);
  }
}

function readResult(json: string): AgentAsset {
  const result: unknown = JSON.parse(json);
  if (typeof result !== "object" || result === null)
    throw new Error("Invalid stored asset result");
  const assetId: unknown = Reflect.get(result, "assetId");
  const link: unknown = Reflect.get(result, "link");
  const fileName: unknown = Reflect.get(result, "fileName");
  const contentType: unknown = Reflect.get(result, "contentType");
  const size: unknown = Reflect.get(result, "size");
  if (
    typeof assetId !== "string" ||
    typeof link !== "string" ||
    typeof fileName !== "string" ||
    typeof contentType !== "string" ||
    typeof size !== "number"
  )
    throw new Error("Invalid stored asset result");
  return {
    assetId,
    link,
    fileName,
    contentType,
    size,
    expiresAt: null,
    digest:
      typeof Reflect.get(result, "digest") === "string"
        ? String(Reflect.get(result, "digest"))
        : undefined,
    sourceAttachmentId:
      typeof Reflect.get(result, "sourceAttachmentId") === "string"
        ? String(Reflect.get(result, "sourceAttachmentId"))
        : undefined,
    replaces: Reflect.get(result, "replaces") === true,
    sourceType: readSourceType(Reflect.get(result, "sourceType")),
    sourceLink:
      typeof Reflect.get(result, "sourceLink") === "string"
        ? String(Reflect.get(result, "sourceLink"))
        : undefined,
  };
}

async function requireCredential(
  identity: AgentIdentity,
  request: AuthorizedAssetReturn,
  scope: TaskDatabase,
): Promise<void> {
  if (identity.run) {
    const current = await new AgentRunCredentialRepository(scope).findValid(
      request.credentialHash,
      Date.now(),
    );
    if (
      !current ||
      current.userId !== identity.userId ||
      current.scope.reach !== "full" ||
      current.scope.runId !== identity.run.runId ||
      current.scope.stepId !== identity.run.stepId
    )
      throw new AgentOperationError("FORBIDDEN");
    return;
  }
  const owner = await new PersonalAgentTokenRepository(scope).findOwner(
    request.credentialHash,
    Date.now(),
  );
  if (owner !== identity.userId) throw new AgentOperationError("FORBIDDEN");
}

function shouldReplace(
  request: AuthorizedAssetReturn,
): request is AuthorizedAssetReturn &
  Required<
    Pick<AuthorizedAssetReturn, "sourceAttachmentId" | "expectedDigest">
  > {
  return (
    request.replace === true &&
    typeof request.sourceAttachmentId === "string" &&
    typeof request.expectedDigest === "string"
  );
}

async function requireOutput(bytes: Buffer): Promise<void> {
  if (bytes.length === 0) throw new AgentOperationError("INVALID_REQUEST");
  try {
    await assetRepresentation(bytes);
  } catch {
    throw new AgentOperationError("INVALID_REQUEST");
  }
}

function sourceReference(
  input: AttachmentReturnInput,
  id: string,
): AgentTicketAsset {
  const source = input.request.sourceType ?? input.destination.type;
  const prefixes = {
    ticket: "/aufgaben/attachments/",
    wiki: "/wiki/attachments/",
    agent: "/agent-assets/",
  };
  return { source, id, link: prefixes[source] + id };
}

function requireSourceDigest(
  digest: string,
  input: AttachmentReturnInput,
): void {
  if (digest !== input.request.expectedDigest)
    throw new AgentOperationError("CONFLICT");
  if (digest === input.digest) throw new AgentOperationError("INVALID_REQUEST");
}

function readSourceType(
  input: unknown,
): AgentTicketAsset["source"] | undefined {
  return input === "ticket" || input === "wiki" || input === "agent"
    ? input
    : undefined;
}

async function readSourceOrigin(input: {
  readonly scope: TaskDatabase;
  readonly directory: string;
  readonly actor: User;
  readonly reference: AgentTicketAsset;
}): Promise<Awaited<ReturnType<AgentTicketAssetService["read"]>>> {
  try {
    return await assetReturnSources(input.scope, input.directory).read(
      input.actor,
      input.reference,
    );
  } catch {
    throw new AgentOperationError("NOT_FOUND");
  }
}

function assetReturnResult(
  attachment: AgentAsset,
  input: AttachmentReturnInput,
): AgentAsset {
  const sourceId = input.request.sourceAttachmentId;
  const source = sourceId ? sourceReference(input, sourceId) : undefined;
  return {
    ...attachment,
    digest: input.digest,
    sourceAttachmentId: sourceId,
    sourceType: source?.source,
    sourceLink: source?.link,
    replaces: input.request.replace ?? false,
  };
}
