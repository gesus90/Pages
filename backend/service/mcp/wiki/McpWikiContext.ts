import { McpWikiError } from "./McpWikiError";

import type { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { UserService } from "@/backend/service/UserService";
import type { WikiService } from "@/backend/service/WikiService";
import type { User } from "@/definition/User";
import type { WikiPageView } from "@/definition/Wiki";
import type { McpWikiPerson } from "./McpWikiContract";

/**
 * The services the wiki API calls: the very ones the interface uses.
 *
 * @remarks
 * The API adds no right and no rule of its own; every read and change goes
 * through the announcing wiki service with the paired account as the actor,
 * so rights, visibility, versions and events are those of the interface.
 */
export interface McpWikiDependencies {
  readonly wiki: WikiService;
  readonly users: Pick<UserService, "getById" | "findCredentialsByUsername">;
  /** Runs a revision check and the change it guards as one call. */
  readonly calls: Pick<PagesEventPublisher, "announce">;
  /** Results of saves by operation ID, the journal the interface keeps its saves in. */
  readonly operations: AgentOperationKeyRepository;
}

/**
 * Everything one request of the wiki API works with: the account of the
 * paired machine, the services and the people it has resolved so far.
 */
export class McpWikiContext {
  public readonly actor: User;
  public readonly services: McpWikiDependencies;
  private readonly people = new Map<string, Promise<User | null>>();

  /**
   * Creates the context of one request.
   *
   * @param actor - The account the device token acts for.
   * @param services - The wiki services of the interface.
   */
  public constructor(actor: User, services: McpWikiDependencies) {
    this.actor = actor;
    this.services = services;
  }

  /**
   * Reads a page with the rights of the account, without noting a visit.
   *
   * @param id - Page identifier.
   * @throws {WikiPageNotFoundError} When it does not exist or is hidden; an
   * administrator gets no placeholder of a private page either.
   */
  public async page(id: string): Promise<WikiPageView> {
    return this.services.wiki.view(this.actor, id);
  }

  /**
   * Reads a page and checks that the client still knows its revision.
   *
   * @param id - Page identifier.
   * @param expectedRevision - The revision the client read.
   * @throws {McpWikiError} `conflict` with the current revision when it changed.
   */
  public async pageAtRevision(
    id: string,
    expectedRevision: number,
  ): Promise<WikiPageView> {
    const view = await this.page(id);
    if (view.page.revision !== expectedRevision)
      throw new McpWikiError("conflict", view.page.revision);
    return view;
  }

  /**
   * Runs a check and the changes it guards as one call of the interface.
   *
   * @param work - Reads, checks and changes through the wiki service.
   * @returns Whatever `work` returns.
   *
   * @remarks
   * The call holds the writer from its start, so nothing commits between the
   * revision read and the change, and a refusal rolls back everything. The
   * announcing wiki service joins the call and stores and announces its own
   * events with it; the call itself adds none.
   */
  public async atomically<Result>(
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.services.calls.announce(work, () => [], {
      decidesChange: true,
    });
  }

  /**
   * Names a person by username and display name.
   *
   * @param userId - Internal id of the person.
   * @param fallbackName - The name the wiki stored, for an account that no longer exists.
   * @returns The person; a removed account keeps its stored name and an empty username.
   */
  public async person(
    userId: string,
    fallbackName: string,
  ): Promise<McpWikiPerson> {
    let pending = this.people.get(userId);
    if (pending === undefined) {
      pending = this.services.users.getById(userId);
      this.people.set(userId, pending);
    }
    const user = await pending;
    return user
      ? { username: user.username, displayName: user.displayName }
      : { username: "", displayName: fallbackName };
  }

  /**
   * Resolves a username to an account a page can be handed to.
   *
   * @param username - The username from the request.
   * @returns The id of the account.
   * @throws {McpWikiError} `not_found` for an unknown name or an account the
   * interface does not offer as an owner.
   */
  public async requireOwnerCandidate(username: string): Promise<string> {
    const credentials = await this.services.users.findCredentialsByUsername(
      username.trim(),
    );
    const candidates = await this.services.wiki.ownerCandidates(this.actor);
    const id = credentials?.user.id;
    if (id === undefined || !candidates.some((entry) => entry.id === id))
      throw new McpWikiError("not_found");
    return id;
  }
}
