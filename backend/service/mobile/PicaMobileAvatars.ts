import { createHash } from "node:crypto";

import { LRUCache } from "lru-cache";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError } from "@/backend/logging/Logger";
import { SUPPORTED_AVATAR_MIME_TYPES, USER_AVATAR_TYPE } from "@/definition/User";

import { shrinkAvatarImage } from "./PicaMobileAvatarImage";

import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";

/** What the avatars need from the user storage. */
export type PicaMobileAvatarSource = Pick<
  UserService,
  "getAvatar" | "getAvatarDigest"
>;

/** The current avatar of an account, ready to send. */
export interface PicaMobileAvatar {
  /** Identifies the stored image; it changes with every new upload. */
  readonly version: string;
  readonly mimeType: string;
  /** The shrunken image bytes, at most as many as the protocol allows. */
  readonly data: Buffer;
}

interface CachedAvatar {
  readonly avatar: PicaMobileAvatar | null;
}

const COMPONENT = "PicaMobileAvatars";
const VERSION_LENGTH = 32;
const MAXIMUM_CACHED_AVATARS = 128;

/**
 * The avatar images Pica Mobile delivers: the current image of the account
 * that asks, shrunk to the protocol limit.
 *
 * @remarks
 * The version is a digest of the stored image, so it changes exactly when the
 * image does and two uploads within one second never share one. The shrunk
 * result is cached by that digest; an image that cannot be delivered is
 * cached as missing, so it is not decoded again on every dashboard request.
 * Decoding runs one image at a time to bound memory.
 */
export class PicaMobileAvatars {
  private readonly cache = new LRUCache<string, CachedAvatar>({
    max: MAXIMUM_CACHED_AVATARS,
  });
  private readonly queue = new SerialQueue();

  /**
   * Reads the current avatar of an account.
   *
   * @param source - The user storage.
   * @param user - The account, as the session resolves it right now.
   * @returns The avatar, or `null` when the account has no image avatar or its
   * image cannot be delivered.
   */
  public async current(
    source: PicaMobileAvatarSource,
    user: User,
  ): Promise<PicaMobileAvatar | null> {
    if (user.avatarType !== USER_AVATAR_TYPE.IMAGE) {
      return null;
    }

    const stored = await source.getAvatarDigest(user.id);

    if (stored === null || !SUPPORTED_AVATAR_MIME_TYPES.has(stored.mimeType)) {
      return null;
    }

    const key = cacheKey(user.id, stored.sha256);
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      return cached.avatar;
    }

    return this.queue.run(() => this.prepare(source, user.id, key));
  }

  private async prepare(
    source: PicaMobileAvatarSource,
    userId: string,
    key: string,
  ): Promise<PicaMobileAvatar | null> {
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      return cached.avatar;
    }

    const stored = await source.getAvatar(userId);

    if (stored === null) {
      return null;
    }

    const digest = createHash("sha256").update(stored.data).digest("hex");
    let shrunk: Awaited<ReturnType<typeof shrinkAvatarImage>>;

    try {
      shrunk = await shrinkAvatarImage(stored.data, stored.mimeType);
    } catch (error: unknown) {
      // Not cached: a missing image library may be a temporary condition.
      logCaughtError(COMPONENT, error);

      return null;
    }

    const avatar =
      shrunk === null
        ? null
        : { ...shrunk, version: digest.slice(0, VERSION_LENGTH) };

    // The image may have been replaced since the digest was read; its own digest keys it.
    this.cache.set(cacheKey(userId, digest), { avatar });

    return avatar;
  }
}

function cacheKey(userId: string, digest: string): string {
  return `${userId}:${digest}`;
}
