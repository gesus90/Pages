import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import { CHAT_CALL_CREDENTIAL_SECONDS } from "@/backend/config/ChatCallConfig";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ChatCallSetting } from "@/backend/config/ChatCallConfig";
import type {
  ChatCallIceConfiguration,
  ChatCallIceServer,
} from "@/definition/ChatCall";

/** Issues the ICE servers an accepted call connects through. */
export interface ChatCallIce {
  /**
   * Returns the servers for one call.
   * @param callId - The call the credentials belong to.
   * @param now - The time the credentials start at.
   */
  configuration(callId: string, now?: Date): Promise<ChatCallIceConfiguration>;
}

/**
 * Builds the temporary TURN credentials of coturn's REST scheme.
 * @param secret - The `static-auth-secret` of coturn.
 * @param callId - The call the credentials are good for.
 * @param expiresAt - Unix time in seconds at which coturn stops accepting them.
 * @returns The username `<expiry>:<call>` and its HMAC-SHA1 password.
 */
export function turnCredential(
  secret: string,
  callId: string,
  expiresAt: number,
): { readonly username: string; readonly credential: string } {
  const username = `${expiresAt}:${callId}`;
  return {
    username,
    credential: createHmac("sha1", secret).update(username).digest("base64"),
  };
}

async function readSecret(file: string): Promise<string | null> {
  try {
    const secret = (await readFile(file, "utf8")).trim();
    return secret === "" ? null : secret;
  } catch (error: unknown) {
    logCaughtError("ChatCallIce", error);
    return null;
  }
}

async function turnServer(
  setting: ChatCallSetting,
  callId: string,
  now: Date,
): Promise<ChatCallIceServer | null> {
  const { turnUrls, turnSecretFile } = setting;
  if (!turnUrls || turnUrls.length === 0 || !turnSecretFile) return null;
  const secret = await readSecret(turnSecretFile);
  if (secret === null) return null;
  const lifetime =
    setting.turnCredentialSeconds ?? CHAT_CALL_CREDENTIAL_SECONDS.default;
  const expiresAt = Math.floor(now.getTime() / 1000) + lifetime;
  return { urls: turnUrls, ...turnCredential(secret, callId, expiresAt) };
}

/**
 * Creates the issuer of the ICE servers from `[chatCalls]` of `config.toml`.
 * @remarks
 * TURN credentials are temporary and bound to one call. They are only issued
 * for a call whose participant the service checked; a secret file that cannot
 * be read leaves the call without TURN and is logged, never quoted.
 * @param setting - The configured servers; without it no server is named.
 */
export function createChatCallIce(
  setting: ChatCallSetting | undefined,
): ChatCallIce {
  return {
    async configuration(callId, now = new Date()) {
      const servers: ChatCallIceServer[] = [];
      if (setting?.stunUrls && setting.stunUrls.length > 0)
        servers.push({ urls: setting.stunUrls });
      const turn = setting ? await turnServer(setting, callId, now) : null;
      if (turn !== null) servers.push(turn);
      return {
        iceServers: servers,
        isRelayOnly: setting?.relayOnly === true && turn !== null,
      };
    },
  };
}
