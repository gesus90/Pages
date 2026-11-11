import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { TaskService } from "@/backend/service/TaskService";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import type { WikiService } from "@/backend/service/WikiService";
import type { User } from "@/definition/User";

/** Where a file of the agent's working folder is attached. */
export type AgentHostFileTarget =
  | { readonly kind: "ticket"; readonly ticketId: string }
  | { readonly kind: "wikiPage"; readonly pageId: string };

/** The Pages services that store a ticket or wiki attachment with the rights of the uploader. */
export interface AgentHostFileStores {
  readonly tickets: Pick<TaskAttachmentService, "upload">;
  /** Resolves a ticket key such as `PAGE-12`, with the rights of the reader. */
  readonly ticketKeys: Pick<TaskService, "getByKey">;
  readonly wiki: Pick<WikiService, "uploadAttachment">;
}

/** What an attached file became; `ok: false` names why nothing was stored. */
export type AgentHostFileOutcome =
  | {
      readonly ok: true;
      readonly attachmentId: string;
      readonly fileName: string;
      readonly size: number;
      readonly contentType: string;
    }
  | {
      readonly ok: false;
      readonly error: "NOT_FOUND" | "FORBIDDEN" | "INVALID_REQUEST";
      readonly reason: string;
    };

const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/u;

function refused(
  error: "NOT_FOUND" | "FORBIDDEN" | "INVALID_REQUEST",
  reason: string,
): AgentHostFileOutcome {
  return { ok: false, error, reason };
}

/**
 * Resolves a path the agent names to a regular file inside its working folder.
 *
 * @returns The real path, or `null` for a missing file, a folder or a path
 * that leads outside the folder, also through a symbolic link.
 */
async function resolveFile(
  directory: string,
  file: string,
): Promise<string | null> {
  try {
    const root = await realpath(directory);
    const resolved = await realpath(path.resolve(root, file));
    if (!resolved.startsWith(`${root}${path.sep}`)) return null;
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch (error: unknown) {
    logCaughtError("AgentHostFiles", error);
    return null;
  }
}

function translate(error: unknown): AgentHostFileOutcome {
  if (
    error instanceof WorkItemNotFoundError ||
    error instanceof WikiPageNotFoundError
  )
    return refused("NOT_FOUND", "target_missing");
  if (
    error instanceof WorkItemAccessDeniedError ||
    error instanceof WikiAccessDeniedError
  )
    return refused("FORBIDDEN", "target_forbidden");
  if (
    error instanceof WorkItemValidationError ||
    error instanceof WikiValidationError
  )
    return refused("INVALID_REQUEST", error.message);
  throw error;
}

/**
 * Attaches files an agent made in its chat to a ticket or a wiki page (PAGE-303).
 *
 * @remarks
 * The file must lie in the working folder of the chat; a path outside it,
 * also through a link, is refused, so the tool never publishes a credential
 * or live data. The upload runs through the ticket and wiki attachment
 * services with the agent's own account, which check its role, departments
 * and project memberships and the instance limits as for every upload.
 */
export class AgentHostFiles {
  private readonly stores: AgentHostFileStores;

  public constructor(stores: AgentHostFileStores) {
    this.stores = stores;
  }

  /**
   * Attaches one file of the working folder.
   *
   * @param agent - The agent's account, whose rights apply.
   * @param upload - The working folder, the path inside it and the target.
   */
  public async attach(
    agent: User,
    upload: {
      readonly directory: string;
      readonly file: string;
      readonly target: AgentHostFileTarget;
    },
  ): Promise<AgentHostFileOutcome> {
    const resolved = await resolveFile(upload.directory, upload.file);
    if (resolved === null) return refused("INVALID_REQUEST", "file_unusable");
    const size = (await stat(resolved)).size;
    const file = {
      fileName: path.basename(resolved),
      contentLength: size,
      body: createReadStream(resolved),
    };
    try {
      const attachment =
        upload.target.kind === "ticket"
          ? await this.stores.tickets.upload(
              agent,
              await this.ticketId(agent, upload.target.ticketId),
              file,
            )
          : await this.stores.wiki.uploadAttachment(
              agent,
              upload.target.pageId,
              file,
            );
      return {
        ok: true,
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        size: attachment.size,
        contentType: attachment.contentType,
      };
    } catch (error: unknown) {
      logCaughtError("AgentHostFiles", error);
      return translate(error);
    } finally {
      file.body.destroy();
    }
  }

  /** The ID of a ticket the agent names by ID or by key. */
  private async ticketId(agent: User, ticket: string): Promise<string> {
    if (!TICKET_KEY.test(ticket)) return ticket;
    return (await this.stores.ticketKeys.getByKey(agent, ticket)).id;
  }
}
