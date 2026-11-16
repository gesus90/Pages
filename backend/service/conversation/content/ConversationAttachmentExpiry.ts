import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";

import { CONVERSATION_EXPIRY_LEAD_MILLISECONDS } from "./ConversationAttachments";

import type { ConversationAttachments } from "./ConversationAttachments";

const COMPONENT = "ConversationAttachmentExpiry";

/**
 * Removes the files agents attached in chats once their 72 hours end,
 * in the background of the Pages process.
 * @remarks
 * It runs at once when it starts, so a file whose time ran out while Pages
 * was stopped goes right after the restart, and then every five minutes.
 * Each run removes what ends before the next one, so nothing stays beyond
 * its moment. A run that is still going is not started twice.
 */
export class ConversationAttachmentExpiry {
  private readonly attachments: Pick<ConversationAttachments, "expire">;
  private timer: ReturnType<typeof setInterval> | null = null;
  private run: Promise<void> | null = null;

  public constructor(attachments: Pick<ConversationAttachments, "expire">) {
    this.attachments = attachments;
  }

  /** Runs once now and then regularly; a second call changes nothing. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, CONVERSATION_EXPIRY_LEAD_MILLISECONDS);
    this.timer.unref();
    void this.runDue();
  }

  /** Stops the runs and waits for a running one. */
  public async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.run;
  }

  /** Runs once unless a run is going. */
  public runDue(): Promise<void> {
    this.run ??= withBackgroundDatabaseWork(
      "conversation_attachment_expiry",
      () => this.attachments.expire(),
    )
      .then(() => undefined)
      .catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      })
      .finally(() => {
        this.run = null;
      });
    return this.run;
  }
}
