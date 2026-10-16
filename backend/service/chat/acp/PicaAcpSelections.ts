import { readPicaAttachments } from "./PicaAcpContent";

import type { PromptCapabilities } from "@agentclientprotocol/sdk";
import type { ChatSelection, ChatSelectionItem } from "@/definition/ChatJob";
import type {
  PicaAttachmentReader,
  PicaMessageContent,
} from "./PicaAcpContent";
import type { PicaAcpMessage } from "./PicaAcpSteering";

/** Resolves one immutable attachment payload per message, including resume retries and steering races. */
export class PicaAcpSelections {
  private readonly reader: PicaAttachmentReader;
  private readonly record: (selection: ChatSelection) => Promise<void>;
  private readonly contents = new Map<string, Promise<PicaMessageContent>>();
  private readonly selected = new Set<string>();

  public constructor(
    reader: PicaAttachmentReader,
    record: (selection: ChatSelection) => Promise<void>,
  ) {
    this.reader = reader;
    this.record = record;
  }

  /** Reuses exactly the first payload prepared for this message. */
  public read(
    message: PicaAcpMessage,
    capabilities: PromptCapabilities | null | undefined,
  ): Promise<PicaMessageContent> {
    let content = this.contents.get(message.id);
    if (!content) {
      content = readPicaAttachments(
        message.attachments,
        this.reader,
        capabilities,
      );
      this.contents.set(message.id, content);
    }
    return content;
  }

  /** Stores the transfer snapshot once; a failed write may be retried. */
  public async select(
    messageId: string,
    items: readonly ChatSelectionItem[],
  ): Promise<void> {
    if (this.selected.has(messageId)) return;
    await this.record({ messageId, items });
    this.selected.add(messageId);
  }
}
