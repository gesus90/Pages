import {
  WikiAccessDeniedError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { formatWikiCover, parseWikiCover } from "@/definition/Wiki";

import { WikiPageReader } from "./WikiPageReader";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiCover } from "@/definition/Wiki";
import type { WikiAccess } from "./WikiAccess";

/** Image types an attachment needs to be shown as a cover. */
const COVER_IMAGE_TYPES = /^image\/(?:jpeg|png|gif|webp)$/;

/** Sets and removes the optional cover of a page (A8.1). */
export class WikiCoverService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   */
  public constructor(repository: WikiRepository, access: WikiAccess) {
    this.repository = repository;
    this.access = access;
  }

  /**
   * Sets or removes the cover of a page.
   *
   * @param actor - The signed-in user; editing needs the capability "write".
   * @param id - Page identifier.
   * @param value - `preset:<name>`, `attachment:<id>`, or `null` to remove.
   * @returns The cover as stored.
   * @throws {WikiAccessDeniedError} Without the capability "write".
   * @throws {WikiPageNotFoundError} When the page is missing or hidden.
   * @throws {WikiValidationError} For an unknown preset, or an attachment
   * that is no image of this page.
   *
   * @remarks
   * Like the icon, the cover belongs to the page and not to its text: it
   * needs no revision and creates no version.
   */
  public async setCover(
    actor: User,
    id: string,
    value: string | null,
  ): Promise<WikiCover | null> {
    const viewer = await this.access.resolve(actor);

    if (!viewer.canWrite) {
      throw new WikiAccessDeniedError();
    }

    return this.repository.transaction(async (repository) => {
      const page = await new WikiPageReader(repository).require(
        viewer.scope,
        id,
      );
      const cover = value === null ? null : parseWikiCover(value);

      if (value !== null && cover === null) {
        throw new WikiValidationError("invalidCover");
      }

      if (cover?.kind === "attachment") {
        const attachment = await repository.attachments.find(
          cover.attachmentId,
        );

        if (
          attachment?.pageId !== page.id ||
          attachment.kind !== "media" ||
          !COVER_IMAGE_TYPES.test(attachment.contentType)
        ) {
          throw new WikiValidationError("invalidCover");
        }
      }

      await repository.writes.setCover(
        page.id,
        cover ? formatWikiCover(cover) : null,
      );

      return cover;
    });
  }
}
