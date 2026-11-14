import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { PicaAttachmentReader } from "@/backend/service/chat/acp/PicaAcpContent";
import type { PicaAcpConversationTurn } from "@/backend/service/chat/acp/PicaAcpSteering";
import type { ConversationAgentRequest } from "@/backend/service/conversation/ConversationAgentReplies";

/** Adapts conversation files to the existing negotiated image and document delivery. */
export function conversationTurnPreparation(
  request: ConversationAgentRequest,
):
  | ((afterSequence: number | null) => Promise<PicaAcpConversationTurn>)
  | undefined {
  const { prepareTurn, openAttachment } = request;
  if (!prepareTurn || !openAttachment) return undefined;
  return async (afterSequence) => {
    const turn = await prepareTurn(afterSequence);
    const attachments: StoredChatAttachment[] = turn.attachments.map(
      (file) => ({
        id: file.id,
        fileName: file.name,
        contentType: file.mimeType,
        size: file.sizeBytes,
        sessionId: request.conversation.id,
        messageId: null,
        storageName: file.id,
      }),
    );
    const allowed = new Set(attachments.map((file) => file.id));
    const open = async (
      file: StoredChatAttachment,
    ): Promise<AsyncIterable<Uint8Array>> => {
      if (!allowed.has(file.id))
        throw new Error("Attachment is outside this turn.");
      return openAttachment(file.id);
    };
    const attachmentReader: PicaAttachmentReader = {
      readBytes: async (file, maximum) => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of await open(file)) {
          size += chunk.byteLength;
          if (size > maximum) return null;
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      },
      readText: async (file, maximum) => {
        const decoder = new TextDecoder();
        let text = "";
        for await (const chunk of await open(file)) {
          text += decoder.decode(chunk, { stream: true });
          if (Array.from(text).length >= maximum)
            return Array.from(text).slice(0, maximum).join("");
        }
        return Array.from(text + decoder.decode())
          .slice(0, maximum)
          .join("");
      },
    };
    return {
      text: turn.prompt,
      attachments,
      attachmentReader,
      throughSequence: turn.throughSequence,
    };
  };
}
