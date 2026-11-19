import { ConversationAttachmentRepository } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import { ConversationWebPackageRepository } from "@/backend/database/repositories/conversation/ConversationWebPackageRepository";
import { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import { ConversationWebPackages } from "@/backend/service/conversation/content/ConversationWebPackages";

import type { Database } from "@/backend/database/Database";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";

/** The attachments of chats and the web export packages that go with them. */
export interface ConversationAttachmentStores {
  readonly attachments: ConversationAttachments;
  readonly webPackages: ConversationWebPackages;
}

/**
 * Creates the attachment store of chats and the store of web export
 * packages, which share the file store and remove package files with their
 * manifest attachment.
 * @param input - The database and the origins of `config.toml`.
 * @param parts - The conversations, the file store and the directory.
 * @returns Both stores.
 */
export function createConversationAttachmentStores(
  input: {
    readonly database: Database;
    readonly publicUrl?: string;
    readonly chatPlayerOrigin?: string;
  },
  parts: {
    readonly conversations: ConversationRepository;
    readonly files: WikiFileStore;
    readonly directory: ConversationDirectory;
  },
): ConversationAttachmentStores {
  const { conversations, files, directory } = parts;
  const attachmentRows = new ConversationAttachmentRepository(input.database);
  const packageRows = new ConversationWebPackageRepository(input.database);
  const attachments = new ConversationAttachments({
    attachments: attachmentRows,
    conversations,
    files,
    directory,
    packageFiles: packageRows,
  });
  const webPackages = new ConversationWebPackages({
    packages: packageRows,
    attachments: attachmentRows,
    staging: attachments,
    conversations,
    files,
    ...(input.chatPlayerOrigin === undefined
      ? {}
      : { playerOrigin: input.chatPlayerOrigin }),
    ...(input.publicUrl === undefined ? {} : { publicUrl: input.publicUrl }),
  });
  return { attachments, webPackages };
}
