import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import type { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import type { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { User } from "@/definition/User";
import type { TextAssistantContext } from "@/definition/TextAssistant";

/** Resolves current read/write rights without recording visits or changing document fields. */
export class TextAssistantContextService {
  private readonly wikiAccess: WikiAccess;
  private readonly pages: WikiPageReader;
  private readonly tickets: TaskAccessGuard;

  public constructor(
    wikiAccess: WikiAccess,
    pages: WikiPageReader,
    tickets: TaskAccessGuard,
  ) {
    this.wikiAccess = wikiAccess;
    this.pages = pages;
    this.tickets = tickets;
  }

  /** Checks visibility separately from writing and returns the saved version for comparison. */
  public async read(
    actor: User,
    context: TextAssistantContext,
  ): Promise<{
    readonly version: string;
    readonly canEdit: boolean;
  }> {
    if (context.kind === "wiki") {
      const viewer = await this.wikiAccess.resolve(actor);
      const page = await this.pages.require(viewer.scope, context.id);
      return { version: String(page.revision), canEdit: viewer.canWrite };
    }
    const ticket = await this.tickets.requireWorkItem(actor, context.id);
    return {
      version: ticket.description,
      canEdit:
        ticket.archivedAt === null && (await this.tickets.canWrite(actor)),
    };
  }

  /** Validates the pinned saved version before generation and again before applying a suggestion. */
  public async validate(
    actor: User,
    context: TextAssistantContext,
    change: "answer" | "replace" | "insert",
  ): Promise<void> {
    const current = await this.read(actor, context);
    if (change !== "answer" && !current.canEdit)
      throw new TextAssistantError("accessDenied");
    if (current.version !== context.version)
      throw new TextAssistantError("versionConflict");
  }
}
