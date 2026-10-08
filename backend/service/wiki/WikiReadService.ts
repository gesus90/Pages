import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { describePermissions } from "./WikiAccess";
import { WikiPageReader } from "./WikiPageReader";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type {
  WikiHome,
  WikiNavigation,
  WikiPageView,
  WikiPrivatePlaceholder,
} from "@/definition/Wiki";
import type { WikiAccess } from "./WikiAccess";
import type { WikiTrashService } from "./WikiTrashService";

/** What opening a page address shows. */
export type WikiReadResult =
  | { readonly kind: "page"; readonly view: WikiPageView }
  | {
      readonly kind: "placeholder";
      readonly placeholder: WikiPrivatePlaceholder;
    };

/** How many pages the lists of the start page show. */
const HOME_LIST_LENGTH = 10;

/** Reads pages, the navigation tree and the start page for a viewer. */
export class WikiReadService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;
  private readonly trash: WikiTrashService;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   * @param trash - Decides whether an administrator gets a placeholder.
   */
  public constructor(
    repository: WikiRepository,
    access: WikiAccess,
    trash: WikiTrashService,
  ) {
    this.repository = repository;
    this.access = access;
    this.trash = trash;
  }

  /**
   * Opens a page and remembers the visit.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @returns The page with the rights of the actor, or the placeholder an
   * administrator gets for a private page of somebody else.
   * @throws {WikiPageNotFoundError} For a missing page and for a page the
   * actor may not see alike.
   */
  public async read(actor: User, id: string): Promise<WikiReadResult> {
    const viewer = await this.access.resolve(actor);
    const reader = new WikiPageReader(this.repository);
    const record = await this.repository.pages.findVisible(viewer.scope, id);

    if (!record) {
      const placeholder = await this.trash.findPlaceholder(actor, id);

      if (!placeholder) {
        throw new WikiPageNotFoundError();
      }

      return { kind: "placeholder", placeholder };
    }

    await this.repository.state.recordVisit(actor.id, id);

    const [page, children, favoriteIds] = await Promise.all([
      reader.assemble(record),
      this.repository.pages.listChildren(viewer.scope, id),
      this.repository.state.listFavoriteIds(actor.id),
    ]);

    return {
      kind: "page",
      view: {
        children,
        isFavorite: favoriteIds.includes(id),
        page,
        permissions: describePermissions(viewer, record),
      },
    };
  }

  /**
   * Builds the data of the left navigation.
   *
   * @param actor - The signed-in user.
   * @returns Visible pages, the projects that can hold pages, and the
   * personal state; favorites, open branches and recent pages are reduced to
   * pages the actor still sees.
   */
  public async navigation(actor: User): Promise<WikiNavigation> {
    const viewer = await this.access.resolve(actor);
    const [nodes, projects, favoriteIds, expandedIds, recentIds] =
      await Promise.all([
        this.repository.pages.listNodes(viewer.scope),
        this.repository.lookups.findProjectNames(viewer.scope.projectIds),
        this.repository.state.listFavoriteIds(actor.id),
        this.repository.state.listExpandedIds(actor.id),
        this.repository.state.listRecentIds(actor.id),
      ]);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    return {
      canCreate: viewer.canWrite,
      expandedIds: expandedIds.filter((id) => byId.has(id)),
      favoriteIds: favoriteIds.filter((id) => byId.has(id)),
      nodes,
      projects,
      recent: recentIds.flatMap((id) => {
        const node = byId.get(id);

        return node ? [{ icon: node.icon, id, title: node.title }] : [];
      }),
    };
  }

  /**
   * Builds the lists of the wiki start page.
   *
   * @param actor - The signed-in user.
   * @returns Recently edited pages, pages owned by the actor, favorites and
   * all visible pages.
   */
  public async home(actor: User): Promise<WikiHome> {
    const viewer = await this.access.resolve(actor);
    const [all, favoriteIds] = await Promise.all([
      this.repository.pages.listSummaries(viewer.scope),
      this.repository.state.listFavoriteIds(actor.id),
    ]);

    return {
      all,
      favorites: all.filter((page) => favoriteIds.includes(page.id)),
      mine: all.filter((page) => page.ownerId === actor.id),
      recentlyEdited: all.slice(0, HOME_LIST_LENGTH),
    };
  }

  /**
   * Lists the templates the actor may use.
   *
   * @param actor - The signed-in user.
   * @returns Template pages by title, without their text.
   */
  public async templates(
    actor: User,
  ): Promise<{ id: string; title: string; icon: string | null }[]> {
    const viewer = await this.access.resolve(actor);
    const templates = await this.repository.pages.listTemplates(viewer.scope);

    return templates.map(({ icon, id, title }) => ({ icon, id, title }));
  }

  /**
   * Marks or unmarks a favorite.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param isFavorite - Whether the page is a favorite afterwards.
   * @throws {WikiPageNotFoundError} When the actor may not see the page.
   */
  public async setFavorite(
    actor: User,
    id: string,
    isFavorite: boolean,
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await new WikiPageReader(this.repository).require(viewer.scope, id);
    await this.repository.state.setFavorite(actor.id, id, isFavorite);
  }

  /**
   * Opens or closes a branch of the tree for the actor.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param isExpanded - Whether the branch is open afterwards.
   * @throws {WikiPageNotFoundError} When the actor may not see the page.
   */
  public async setExpanded(
    actor: User,
    id: string,
    isExpanded: boolean,
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await new WikiPageReader(this.repository).require(viewer.scope, id);
    await this.repository.state.setExpanded(actor.id, id, isExpanded);
  }
}
