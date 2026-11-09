import type { ConversationVoice } from "@/definition/Conversation";

/** Audio runs no script and loads nothing. */
const VOICE_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/**
 * The headers of the audio of a voice message, for the web and for Pica Mobile.
 *
 * @param voice - The audio that is sent.
 * @returns Headers that let a player play the audio and keep any cache private.
 */
export function conversationVoiceHeaders(
  voice: Pick<ConversationVoice, "mimeType" | "sizeBytes">,
): Record<string, string> {
  return {
    "Cache-Control": "private, no-cache",
    "Content-Length": String(voice.sizeBytes),
    "Content-Security-Policy": VOICE_CONTENT_SECURITY_POLICY,
    "Content-Type": voice.mimeType,
    "X-Content-Type-Options": "nosniff",
  };
}
