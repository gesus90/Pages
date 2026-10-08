import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiFeedItem } from "@/definition/Wiki";
import type { WikiAccess } from "./WikiAccess";

/** The area "For me" on the wiki start page. */
export class WikiFeedService {
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
   * Lists what concerns the person.
   *
   * @param actor - The signed-in user.
   * @returns Mentions, replies to their comments, comments on their pages and
   * their pages that are no longer current, newest first. Entries newer than
   * the last time they marked the area as read are unread. Only entries about
   * pages they can see appear.
   */
  public async forMe(actor: User): Promise<WikiFeedItem[]> {
    const viewer = await this.access.resolve(actor);
    const today = new Date().toISOString().slice(0, 10);
    const [items, readAt] = await Promise.all([
      this.repository.feed.collect(viewer.scope, today),
      this.repository.feed.findReadTime(actor.id),
    ]);

    return items.map((item) => ({ ...item, isUnread: item.at > readAt }));
  }

  /**
   * Marks everything up to now as read.
   *
   * @param actor - The signed-in user.
   */
  public async markRead(actor: User): Promise<void> {
    await this.repository.feed.markRead(actor.id);
  }
}
