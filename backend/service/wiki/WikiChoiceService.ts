import { canManagePage } from "./WikiAccess";
import { WikiPageReader } from "./WikiPageReader";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAnchorChoices, WikiOwnerCandidate } from "@/definition/Wiki";
import type { WikiAccess } from "./WikiAccess";

/** Lists what a person can pick when they tie a page or hand it over. */
export class WikiChoiceService {
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
   * Lists the anchors a page can get, for someone who manages the page.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @returns Departments, milestones and epics the actor can read, and the
   * anchors of the page; empty choices unless the actor manages the page.
   * @throws {WikiPageNotFoundError} When the actor may not see the page.
   *
   * @remarks
   * A project page offers only targets of its project. Epics follow the
   * ticket rule: the department of the epic must be visible to the actor.
   */
  public async anchorChoices(
    actor: User,
    id: string,
  ): Promise<WikiAnchorChoices> {
    const viewer = await this.access.resolve(actor);
    const page = await new WikiPageReader(this.repository).require(
      viewer.scope,
      id,
    );
    const selected = (await this.repository.anchors.findAnchors(id)).map(
      ({ kind, targetId }) => ({ kind, targetId }),
    );

    if (!canManagePage(viewer, page) || page.scope === "private") {
      return { departments: [], epics: [], milestones: [], selected };
    }

    const projectIds =
      page.projectId === null
        ? viewer.scope.projectIds
        : viewer.scope.projectIds.filter(
            (projectId) => projectId === page.projectId,
          );
    const [departments, milestones, epics] = await Promise.all([
      this.repository.lookups.listDepartments(),
      this.repository.lookups.listMilestones(projectIds),
      this.repository.lookups.listEpics(projectIds),
    ]);

    return {
      departments: departments.filter(
        (department) =>
          viewer.scope.isAdmin ||
          viewer.scope.departmentIds.includes(department.id),
      ),
      epics: epics.filter(
        (epic) =>
          viewer.scope.isAdmin ||
          epic.departmentId === null ||
          viewer.scope.departmentIds.includes(epic.departmentId),
      ),
      milestones,
      selected,
    };
  }

  /**
   * Lists the accounts a page can be handed to.
   *
   * @param actor - The signed-in user.
   * @returns Active accounts by name; empty unless the actor can write.
   */
  public async ownerCandidates(actor: User): Promise<WikiOwnerCandidate[]> {
    const viewer = await this.access.resolve(actor);

    return viewer.canWrite ? this.repository.lookups.listActiveUsers() : [];
  }
}
