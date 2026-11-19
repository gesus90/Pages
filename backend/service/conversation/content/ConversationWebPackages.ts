import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  CONVERSATION_WEB_PACKAGE_FILE_MAXIMUM_BYTES,
  CONVERSATION_WEB_PACKAGE_GRANT_MILLISECONDS,
  CONVERSATION_WEB_PACKAGE_MANIFEST_MAXIMUM_BYTES,
  CONVERSATION_WEB_PACKAGE_MANIFEST_NAME,
  CONVERSATION_WEB_PACKAGE_MIME_TYPE,
  conversationWebPackageManifestSchema,
} from "@/definition/ConversationInteractiveContent";
import { CONVERSATION_THUMBNAIL_MAXIMUM_BYTES } from "@/definition/ConversationContent";

import { isConversationAttachmentExpired } from "./ConversationAttachments";
import { WebPackageError } from "./ConversationWebPackageFiles";
import {
  PLAYER_BOOT_NAME,
  PLAYER_ENTRY_NAME,
  playerBootScript,
  playerEntryDocument,
  playerPolicy,
} from "./ConversationWebPlayerDocument";

import type { ReadStream } from "node:fs";
import type {
  ConversationAttachmentRepository,
  StoredConversationAttachment,
} from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type {
  ConversationWebPackageRepository,
  StoredWebPackageFile,
  StoredWebPackageGrant,
} from "@/backend/database/repositories/conversation/ConversationWebPackageRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  ConversationWebPackageManifest,
  ConversationWebPackageSession,
} from "@/definition/ConversationInteractiveContent";
import type { User } from "@/definition/User";
import type { ConversationAttachments } from "./ConversationAttachments";
import type { InspectedWebPackage } from "./ConversationWebPackageFiles";

const COMPONENT = "ConversationWebPackages";
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;
/** Starts of a player stay in the table this long after their end. */
const STALE_GRANT_MILLISECONDS = 24 * 60 * 60 * 1000;
const UNSAFE_NAME = /[/\\\u0000-\u001f\u007f]/gu;

/** What the web export packages of chats use. */
export interface ConversationWebPackagesDependencies {
  readonly packages: ConversationWebPackageRepository;
  readonly attachments: Pick<ConversationAttachmentRepository, "find">;
  readonly staging: Pick<ConversationAttachments, "stage" | "release">;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly files: Pick<WikiFileStore, "write" | "open" | "remove">;
  /**
   * The origin the players run on, apart from Pages, as
   * `https://play.pages.example`; missing: the players run on the origin of
   * Pages in a frame the browser gives an opaque origin.
   */
  readonly playerOrigin?: string;
  /** The origin of Pages, which alone may frame a player of an own origin. */
  readonly publicUrl?: string;
  readonly now?: () => Date;
}

/** One answer of a player: the entry page, its start script or a file of the package. */
export interface PlayerFile {
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly body: string | ReadStream;
  /** The `Content-Security-Policy` of the answer. */
  readonly policy: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The name of the manifest attachment: the title or directory of the export. */
function attachmentName(inspected: InspectedWebPackage): string {
  const base = (inspected.manifest.title ?? inspected.directoryName)
    .replace(UNSAFE_NAME, " ")
    .trim()
    .slice(0, 200);
  return base === ""
    ? CONVERSATION_WEB_PACKAGE_MANIFEST_NAME
    : `${base}.${CONVERSATION_WEB_PACKAGE_MANIFEST_NAME}`;
}

/** The manifest bytes as the asynchronous source the attachment store reads. */
async function* manifestSource(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(bytes);
}

async function readStream(source: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > CONVERSATION_WEB_PACKAGE_MANIFEST_MAXIMUM_BYTES)
      throw new ConversationError("too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/**
 * The web export packages of chats: a Godot web build that an agent's answer
 * attaches by its manifest, and the starts of its player.
 * @remarks
 * A package is not a regular attachment: regular attachments never take
 * WebAssembly, and the HTML preview of the chat talks to the chat. The
 * manifest is the attachment; its files are copied into the file store of
 * the chat with their checksums checked again and recorded together, and
 * only then the attachment is bound to the answer, so a member sees the
 * package complete or not at all. The files are served only to a started
 * player: a secret address of 30 minutes for one member, checked against
 * the membership of the chat on every request, that ends when the player is
 * stopped, the member leaves, or the attachment expires. The player never
 * carries the sign-in of Pages and has no bridge to the chat.
 */
export class ConversationWebPackages {
  private readonly dependencies: ConversationWebPackagesDependencies;

  public constructor(dependencies: ConversationWebPackagesDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether the players run on an origin of their own, apart from Pages. */
  public get isOwnOrigin(): boolean {
    const { playerOrigin, publicUrl } = this.dependencies;
    return (
      playerOrigin !== undefined &&
      publicUrl !== undefined &&
      new URL(playerOrigin).origin !== new URL(publicUrl).origin
    );
  }

  /** The origin of the players, when they run on one of their own. */
  public get playerFrameOrigin(): string | null {
    const { playerOrigin } = this.dependencies;
    return this.isOwnOrigin && playerOrigin !== undefined
      ? new URL(playerOrigin).origin
      : null;
  }

  /**
   * Whether a request of a player may be answered at its address: with an
   * own player origin only on that host, otherwise on the host of Pages.
   * @param requestUrl - The address of the request.
   */
  public servesHost(requestUrl: string): boolean {
    const { playerOrigin } = this.dependencies;
    if (!this.isOwnOrigin || playerOrigin === undefined) return true;
    return new URL(requestUrl).host === new URL(playerOrigin).host;
  }

  /**
   * Stores a checked package for an agent's answer, before the answer is
   * stored; it stays unbound until the answer binds it.
   * @param target - The conversation and the agent that sends the answer.
   * @param inspected - The package as {@link inspectWebPackage} checked it.
   * @returns The manifest attachment.
   * @throws {WebPackageError} `checksum` when a file changed since it was
   * checked, `storeFailed` when a file could not be stored; nothing stays.
   */
  public async stage(
    target: { readonly conversationId: string; readonly senderId: string },
    inspected: InspectedWebPackage,
  ): Promise<StoredConversationAttachment> {
    const stored = await this.copyFiles(inspected);
    let attachment: StoredConversationAttachment | null = null;
    try {
      attachment = await this.dependencies.staging.stage(target, {
        name: attachmentName(inspected),
        mimeType: CONVERSATION_WEB_PACKAGE_MIME_TYPE,
        source: manifestSource(inspected.manifestBytes),
        ...(await this.posterOf(inspected)),
      });
      await this.dependencies.packages.insertFiles(attachment.id, stored);
      return attachment;
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      if (attachment !== null)
        await this.dependencies.staging.release(target.senderId, [
          attachment.id,
        ]);
      await this.dependencies.files.remove(
        stored.map((file) => file.storageName),
      );
      throw error instanceof WebPackageError
        ? error
        : new WebPackageError("storeFailed");
    }
  }

  /**
   * Starts the player of a package for a member of its chat.
   * @param person - The signed-in account.
   * @param attachmentId - The manifest attachment.
   * @returns The address of the entry page and when it ends.
   * @throws {ConversationError} `not_found` for a missing, expired or
   * incomplete package or one of a chat the account is no member of.
   */
  public async grant(
    person: User,
    attachmentId: unknown,
  ): Promise<ConversationWebPackageSession> {
    const attachment = await this.requireVisible(person.id, attachmentId);
    await this.readCompleteManifest(attachment);
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = new Date(
      now.getTime() + CONVERSATION_WEB_PACKAGE_GRANT_MILLISECONDS,
    ).toISOString();
    await this.dependencies.packages.insertGrant({
      tokenHash: hashToken(token),
      attachmentId: attachment.id,
      userId: person.id,
      createdAt: now.toISOString(),
      expiresAt,
      staleBefore: new Date(
        now.getTime() - STALE_GRANT_MILLISECONDS,
      ).toISOString(),
    });
    // Pages frames a player of an own origin through its frame document,
    // since the policy of the chat page frames only Pages itself.
    return {
      url: this.isOwnOrigin
        ? `/chat/player-frame/${token}`
        : `/chat-player/${token}/${PLAYER_ENTRY_NAME}`,
      expiresAt,
      isOwnOrigin: this.isOwnOrigin,
    };
  }

  /**
   * The entry page of a running start of the account on the own player
   * origin, for the frame document of Pages.
   * @param person - The signed-in account.
   * @param token - The secret of the start, from its address.
   * @returns The address of the entry page on the player origin.
   * @throws {ConversationError} `not_found` without an own player origin,
   * for an unknown, stopped or ended start, a start of another account, a
   * member who left the chat or an expired package.
   */
  public async playerFrameAddress(
    person: User,
    token: unknown,
  ): Promise<string> {
    const origin = this.playerFrameOrigin;
    if (origin === null) throw new ConversationError("not_found");
    const grant = await this.activeGrant(token);
    if (grant.userId !== person.id) throw new ConversationError("not_found");
    await this.requireVisible(grant.userId, grant.attachmentId);
    return `${origin}/chat-player/${String(token)}/${PLAYER_ENTRY_NAME}`;
  }

  /**
   * Ends a start of a player of the account; an unknown or ended one stays as it is.
   * @param person - The signed-in account.
   * @param token - The secret of the start, from its address.
   */
  public async revoke(person: User, token: unknown): Promise<void> {
    if (typeof token !== "string" || !TOKEN.test(token)) return;
    await this.dependencies.packages.revokeGrant(
      hashToken(token),
      person.id,
      this.now().toISOString(),
    );
  }

  /**
   * Opens one answer of a started player.
   * @param token - The secret of the start, from its address.
   * @param fileName - The entry page, the start script or a file of the package.
   * @throws {ConversationError} `not_found` for an unknown, stopped or ended
   * start, a member who left the chat, an expired package or an unknown file.
   */
  public async openPlayerFile(
    token: unknown,
    fileName: unknown,
  ): Promise<PlayerFile> {
    if (typeof fileName !== "string") throw new ConversationError("not_found");
    const grant = await this.activeGrant(token);
    const attachment = await this.requireVisible(
      grant.userId,
      grant.attachmentId,
    );
    const { manifest, files } = await this.readCompleteManifest(attachment);
    const policy = playerPolicy(this.frameAncestor());
    if (fileName === PLAYER_ENTRY_NAME)
      return this.textFile(playerEntryDocument(manifest), "text/html", policy);
    if (fileName === PLAYER_BOOT_NAME)
      return this.textFile(
        playerBootScript(manifest),
        "text/javascript",
        policy,
      );
    const file = files.find((entry) => entry.path === fileName);
    if (!file) throw new ConversationError("not_found");
    return {
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      body: this.dependencies.files.open(file.storageName),
      policy,
    };
  }

  /** A start that is neither stopped nor ended, by its secret. */
  private async activeGrant(token: unknown): Promise<StoredWebPackageGrant> {
    if (typeof token !== "string" || !TOKEN.test(token))
      throw new ConversationError("not_found");
    const grant = await this.dependencies.packages.findGrant(hashToken(token));
    if (
      !grant ||
      grant.revokedAt !== null ||
      grant.expiresAt <= this.now().toISOString()
    )
      throw new ConversationError("not_found");
    return grant;
  }

  /** Copies every file of a package into the store and checks it on the way. */
  private async copyFiles(
    inspected: InspectedWebPackage,
  ): Promise<StoredWebPackageFile[]> {
    const stored: StoredWebPackageFile[] = [];
    try {
      for (const file of inspected.files) {
        const written = await this.dependencies.files.write(
          createReadStream(file.sourcePath),
          {
            absoluteLimit: CONVERSATION_WEB_PACKAGE_FILE_MAXIMUM_BYTES,
            limitFor: () => CONVERSATION_WEB_PACKAGE_FILE_MAXIMUM_BYTES,
          },
        );
        stored.push({
          path: file.path,
          storageName: written.storageName,
          mimeType: file.mimeType,
          sizeBytes: written.size,
          sha256: written.checksum,
        });
        if (written.size !== file.sizeBytes || written.checksum !== file.sha256)
          throw new WebPackageError("checksum");
      }
      return stored;
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      await this.dependencies.files.remove(
        stored.map((file) => file.storageName),
      );
      throw error instanceof WebPackageError
        ? error
        : new WebPackageError("storeFailed");
    }
  }

  /** The PNG start image of a package as the preview image of its card, when small enough. */
  private async posterOf(inspected: InspectedWebPackage): Promise<{
    readonly thumbnail?: {
      readonly mimeType: string;
      readonly source: AsyncIterable<Uint8Array>;
    };
  }> {
    const { poster } = inspected.manifest;
    const file = inspected.files.find((entry) => entry.path === poster);
    if (!file) return {};
    const facts = await stat(file.sourcePath);
    if (facts.size > CONVERSATION_THUMBNAIL_MAXIMUM_BYTES) return {};
    return {
      thumbnail: {
        mimeType: "image/png",
        source: createReadStream(file.sourcePath),
      },
    };
  }

  /** The manifest of a package whose files are all stored, as it lists them. */
  private async readCompleteManifest(
    attachment: StoredConversationAttachment,
  ): Promise<{
    readonly manifest: ConversationWebPackageManifest;
    readonly files: readonly StoredWebPackageFile[];
  }> {
    let input: unknown;
    try {
      const bytes = await readStream(
        this.dependencies.files.open(attachment.storageName),
      );
      input = JSON.parse(bytes.toString("utf8"));
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      throw new ConversationError("not_found");
    }
    const parsed = conversationWebPackageManifestSchema.safeParse(input);
    if (!parsed.success) throw new ConversationError("not_found");
    const files = await this.dependencies.packages.files(attachment.id);
    const isComplete = parsed.data.files.every((entry) =>
      files.some(
        (file) =>
          file.path === entry.path &&
          file.sha256 === entry.sha256 &&
          file.sizeBytes === entry.sizeBytes,
      ),
    );
    if (!isComplete || files.length !== parsed.data.files.length)
      throw new ConversationError("not_found");
    return { manifest: parsed.data, files };
  }

  /** The manifest attachment, when the account is a member of its chat now and it was sent. */
  private async requireVisible(
    userId: string,
    attachmentId: unknown,
  ): Promise<StoredConversationAttachment> {
    if (typeof attachmentId !== "string" || !IDENTIFIER.test(attachmentId))
      throw new ConversationError("not_found");
    const attachment = await this.dependencies.attachments.find(attachmentId);
    if (
      !attachment ||
      attachment.messageId === null ||
      attachment.mimeType !== CONVERSATION_WEB_PACKAGE_MIME_TYPE ||
      isConversationAttachmentExpired(attachment, this.now())
    )
      throw new ConversationError("not_found");
    const member = await this.dependencies.conversations.findForMember(
      attachment.conversationId,
      userId,
    );
    if (!member) throw new ConversationError("not_found");
    return attachment;
  }

  private textFile(body: string, mimeType: string, policy: string): PlayerFile {
    return {
      mimeType: `${mimeType}; charset=utf-8`,
      sizeBytes: Buffer.byteLength(body),
      body,
      policy,
    };
  }

  /** Who may frame a player: Pages by its public origin, or the own origin. */
  private frameAncestor(): string {
    const { publicUrl } = this.dependencies;
    return this.isOwnOrigin && publicUrl !== undefined
      ? new URL(publicUrl).origin
      : "'self'";
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
