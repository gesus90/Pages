import { USER_AVATAR_TYPE } from "@/definition/User";

import type { UserAvatarType } from "@/definition/User";

/**
 * Subtle, deterministic color pairs an avatar can be rendered with.
 *
 * @remarks
 * Kept muted on purpose so avatars never compete with the primary accent
 * color used for interactive elements.
 */
const AVATAR_PALETTE: readonly string[] = [
  "bg-[#f4f1ee] text-[#8a5a34]",
  "bg-[#eef0f4] text-[#3f4657]",
  "bg-[#fdf4ee] text-[#c2600f]",
  "bg-[#eef2ee] text-[#3f5a46]",
  "bg-[#f1eef4] text-[#5a3f6a]",
];

/** The icons a user avatar may show. */
const USER_AVATAR_ICON_KEYS = ["rocket", "star", "user"] as const;

/** One of the icons a user avatar may show. */
export type UserAvatarIconKey = (typeof USER_AVATAR_ICON_KEYS)[number];

/** The user fields an avatar can be derived from. */
interface UserAvatarUserData {
  readonly id?: string;
  readonly username?: string;
  readonly displayName?: string;
  readonly avatarType?: UserAvatarType;
  readonly avatarIcon?: string | null;
  readonly avatarColor?: string | null;
  readonly avatarImageUrl?: string | null;
}

/** Everything an avatar is derived from, either as user data or as loose values. */
export interface UserAvatarSource {
  readonly user?: UserAvatarUserData;
  readonly name?: string;
  readonly avatarType?: UserAvatarType;
  readonly avatarIcon?: string | null;
  readonly avatarColor?: string | null;
  readonly avatarImageUrl?: string | null;
}

/** The resolved values an avatar is rendered from. */
export interface ResolvedUserAvatar {
  readonly avatarType: UserAvatarType;
  /** The icon to show, or `null` unless the avatar is an icon avatar with a known icon. */
  readonly iconKey: UserAvatarIconKey | null;
  /** The image address as given, whatever the avatar type is. */
  readonly imageUrl: string | null;
  /** A custom text color chosen by the user, or `null` for the palette color. */
  readonly customColor: string | null;
  readonly initials: string;
  /** The deterministic palette classes used when neither image nor icon is shown. */
  readonly placeholderColorClasses: string;
}

/** What an avatar shows in its circle. */
export type UserAvatarVisual =
  | { readonly kind: "image"; readonly imageUrl: string }
  | { readonly kind: "icon"; readonly iconKey: UserAvatarIconKey }
  | { readonly kind: "initials"; readonly initials: string };

function trimToEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function trimToNull(value: string): string | null {
  return value.trim() || null;
}

function isUserAvatarIconKey(value: string): value is UserAvatarIconKey {
  return USER_AVATAR_ICON_KEYS.some((iconKey) => iconKey === value);
}

/**
 * Returns the two initials shown when no user icon or image is available.
 *
 * @param name - Display name used to derive the initials.
 * @returns The first and last relevant name part initials, maximum two letters.
 */
function getUserInitials(name: string): string {
  const nameParts = name
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== "");
  // The first part, plus the last one when there is more than one.
  const edgeParts = [...nameParts.slice(0, 1), ...nameParts.slice(1).slice(-1)];

  return edgeParts
    .map((part) => Array.from(part).slice(0, 1).join(""))
    .join("")
    .toUpperCase();
}

/**
 * Returns the deterministic pastel color pair for a user placeholder.
 *
 * @param seed - Stable user identifier or fallback name.
 * @returns The Tailwind classes for background and foreground.
 */
function getAvatarFallbackColor(seed: string): string {
  const codePointSum = Array.from(seed).reduce(
    (total, character) => total + Number(character.codePointAt(0)),
    0,
  );
  const paletteIndex = codePointSum % AVATAR_PALETTE.length;

  return AVATAR_PALETTE.slice(paletteIndex, paletteIndex + 1).join("");
}

function resolveIconKey(
  avatarType: UserAvatarType,
  avatarIcon: string | null,
): UserAvatarIconKey | null {
  if (avatarType !== USER_AVATAR_TYPE.ICON || avatarIcon === null) {
    return null;
  }

  return isUserAvatarIconKey(avatarIcon) ? avatarIcon : null;
}

function resolveName({ user, name }: UserAvatarSource): string {
  return (
    trimToEmpty(user?.displayName) ||
    trimToEmpty(user?.username) ||
    trimToEmpty(name)
  );
}

function resolveColorSeed({ user }: UserAvatarSource, name: string): string {
  return trimToEmpty(user?.id) || trimToEmpty(user?.username) || name;
}

/**
 * Resolves what an avatar is derived from into the values it is rendered from.
 *
 * @param source - The user data and the loose values of the avatar.
 * @returns The name, type, icon, image, color and initials of the avatar.
 *
 * @remarks
 * Values of the user data win over the loose values; the display name wins
 * over the username and the loose name.
 */
export function resolveUserAvatar(
  source: UserAvatarSource,
): ResolvedUserAvatar {
  const { user } = source;
  const name = resolveName(source);
  const avatarType =
    user?.avatarType ?? source.avatarType ?? USER_AVATAR_TYPE.INITIALS;
  const avatarIcon = user?.avatarIcon ?? source.avatarIcon ?? null;
  const avatarColor = user?.avatarColor ?? source.avatarColor ?? "";
  const avatarImageUrl = user?.avatarImageUrl ?? source.avatarImageUrl ?? "";

  return {
    avatarType,
    customColor: trimToNull(avatarColor),
    iconKey: resolveIconKey(avatarType, avatarIcon),
    imageUrl: trimToNull(avatarImageUrl),
    initials: getUserInitials(name),
    placeholderColorClasses: getAvatarFallbackColor(
      resolveColorSeed(source, name),
    ),
  };
}

/**
 * Decides what an avatar shows in its circle.
 *
 * @param avatar - The resolved avatar.
 * @param hasImageError - Whether the image of the avatar failed to load.
 * @returns The image of an image avatar, else its icon, else the initials.
 */
export function getUserAvatarVisual(
  avatar: ResolvedUserAvatar,
  hasImageError: boolean,
): UserAvatarVisual {
  if (
    avatar.avatarType === USER_AVATAR_TYPE.IMAGE &&
    !hasImageError &&
    avatar.imageUrl !== null
  ) {
    return { imageUrl: avatar.imageUrl, kind: "image" };
  }

  if (avatar.iconKey !== null) {
    return { iconKey: avatar.iconKey, kind: "icon" };
  }

  return { initials: avatar.initials, kind: "initials" };
}
