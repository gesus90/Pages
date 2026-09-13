import { Rocket, Star, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/app/lib/cn";
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

/** Controlled set of icons a user avatar may render. */
const USER_AVATAR_ICONS = {
  rocket: Rocket,
  star: Star,
  user: UserRound,
} as const;

const USER_AVATAR_SIZES = {
  xs: {
    container: "size-6 text-[11px] font-semibold",
    icon: "size-3.5",
  },
  sm: {
    container: "size-7 text-xs font-semibold",
    icon: "size-4",
  },
  md: {
    container: "size-9 text-sm font-medium",
    icon: "size-5",
  },
  lg: {
    container: "size-12 text-lg font-semibold",
    icon: "size-6",
  },
  xl: {
    container: "size-24 text-3xl font-semibold",
    icon: "size-12",
  },
} as const;

type UserAvatarSize = keyof typeof USER_AVATAR_SIZES;

type UserAvatarIconKey = keyof typeof USER_AVATAR_ICONS;

interface UserAvatarUserData {
  readonly id?: string;
  readonly username?: string;
  readonly displayName?: string;
  readonly avatarType?: UserAvatarType;
  readonly avatarIcon?: string | null;
  readonly avatarColor?: string | null;
  readonly avatarImageUrl?: string | null;
}

interface UserAvatarProps {
  readonly user?: UserAvatarUserData;
  readonly name?: string;
  readonly avatarType?: UserAvatarType;
  readonly avatarIcon?: string | null;
  readonly avatarColor?: string | null;
  readonly avatarImageUrl?: string | null;
  readonly size?: UserAvatarSize;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly title?: string;
}

/**
 * Returns the two initials shown when no user icon or image is available.
 *
 * @param name - Display name used to derive the initials.
 * @returns The first and last relevant name part initials, maximum two letters.
 */
export function getUserInitials(name: string): string {
  const nameParts = name
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== "");
  const firstPart = nameParts.at(0);

  if (!firstPart) {
    return "";
  }

  const lastPart = nameParts.at(-1) ?? firstPart;
  const firstInitial = Array.from(firstPart)[0] ?? "";
  const lastInitial =
    firstPart === lastPart ? "" : (Array.from(lastPart)[0] ?? "");

  return `${firstInitial}${lastInitial}`.toUpperCase();
}

/**
 * Returns the deterministic pastel color pair for a user placeholder.
 *
 * @param seed - Stable user identifier or fallback name.
 * @returns The Tailwind classes for background and foreground.
 */
export function getAvatarFallbackColor(seed: string): string {
  const codePointSum = Array.from(seed).reduce(
    (total, character) => total + (character.codePointAt(0) ?? 0),
    0,
  );
  const paletteIndex = codePointSum % AVATAR_PALETTE.length;

  return AVATAR_PALETTE.at(paletteIndex) ?? AVATAR_PALETTE[0] ?? "";
}

function isUserAvatarIconKey(value: string): value is UserAvatarIconKey {
  return Object.hasOwn(USER_AVATAR_ICONS, value);
}

/** Renders a user's avatar with image, icon, and initials fallback support. */
export function UserAvatar({
  user,
  name,
  avatarType,
  avatarIcon,
  avatarColor,
  avatarImageUrl,
  size = "md",
  className,
  ariaLabel,
  title,
}: UserAvatarProps): React.ReactElement {
  const [hasImageError, setHasImageError] = useState(false);
  const displayName = user?.displayName?.trim() || "";
  const username = user?.username?.trim() || "";
  const resolvedName = displayName || username || name?.trim() || "";
  const resolvedAvatarType =
    user?.avatarType ?? avatarType ?? USER_AVATAR_TYPE.INITIALS;
  const resolvedAvatarIcon = user?.avatarIcon ?? avatarIcon ?? null;
  const resolvedAvatarColor =
    (user?.avatarColor ?? avatarColor ?? "").trim() || null;
  const resolvedAvatarImageUrl =
    (user?.avatarImageUrl ?? avatarImageUrl ?? "").trim() || null;
  const colorSeed = user?.id?.trim() || username || resolvedName;
  const sizeClasses = USER_AVATAR_SIZES[size];
  const iconKey =
    resolvedAvatarType === USER_AVATAR_TYPE.ICON &&
    resolvedAvatarIcon !== null &&
    isUserAvatarIconKey(resolvedAvatarIcon)
      ? resolvedAvatarIcon
      : null;
  const shouldRenderImage =
    resolvedAvatarType === USER_AVATAR_TYPE.IMAGE &&
    resolvedAvatarImageUrl !== null &&
    !hasImageError;
  const shouldRenderIcon = iconKey !== null && !shouldRenderImage;
  const IconComponent = iconKey ? USER_AVATAR_ICONS[iconKey] : null;

  useEffect(() => {
    setHasImageError(false);
  }, [resolvedAvatarImageUrl]);

  function handleImageError(): void {
    setHasImageError(true);
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        sizeClasses.container,
        shouldRenderImage || shouldRenderIcon
          ? "bg-muted text-muted-foreground"
          : getAvatarFallbackColor(colorSeed),
        className,
      )}
      style={resolvedAvatarColor ? { color: resolvedAvatarColor } : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      title={title}
    >
      {shouldRenderImage ? (
        <img
          className="size-full rounded-full object-cover"
          src={resolvedAvatarImageUrl ?? undefined}
          alt=""
          draggable={false}
          onError={handleImageError}
        />
      ) : null}

      {!shouldRenderImage && IconComponent ? (
        <IconComponent
          className={cn("shrink-0", sizeClasses.icon)}
          aria-hidden="true"
        />
      ) : null}

      {!shouldRenderImage && !shouldRenderIcon
        ? getUserInitials(resolvedName)
        : null}
    </span>
  );
}
