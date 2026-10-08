import { WikiValidationError } from "@/backend/error/WikiErrors";

import { WikiPageReader } from "./WikiPageReader";

import type {
  WikiRepository,
  WikiVersion,
  WikiVersionSummary,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess } from "./WikiAccess";

/** Lists and reads the versions of pages. */
export class WikiVersionService {
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
   * Lists the versions of a page.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @returns The versions, newest first.
   * @throws {WikiPageNotFoundError} When the actor may not see the page.
   */
  public async list(actor: User, id: string): Promise<WikiVersionSummary[]> {
    const viewer = await this.access.resolve(actor);

    await new WikiPageReader(this.repository).require(viewer.scope, id);

    return this.repository.versions.list(id);
  }

  /**
   * Reads one version for the preview.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param versionId - Version identifier.
   * @returns The version with its text.
   * @throws {WikiPageNotFoundError} When the actor may not see the page.
   * @throws {WikiValidationError} When the version does not exist.
   */
  public async get(
    actor: User,
    id: string,
    versionId: string,
  ): Promise<WikiVersion> {
    const viewer = await this.access.resolve(actor);

    await new WikiPageReader(this.repository).require(viewer.scope, id);

    const version = await this.repository.versions.find(id, versionId);

    if (!version) {
      throw new WikiValidationError("versionMissing");
    }

    return version;
  }

  /**
   * Removes versions beyond the retention rules.
   *
   * @param retentionDays - Versions younger than this many days stay.
   * @param keepLast - The newest versions of each page stay in any case.
   */
  public async prune(retentionDays: number, keepLast: number): Promise<void> {
    await this.repository.versions.prune(retentionDays, keepLast);
  }
}
