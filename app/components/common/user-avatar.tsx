import { Rocket, Star, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/app/lib/cn";
import {
  getUserAvatarVisual,
  resolveUserAvatar,
} from "@/app/lib/user-avatar-display";
import {
  createUserRingStyle,
  createUserTextColorStyle,
} from "@/app/lib/user-color-style";

import type {
  UserAvatarIconKey,
  UserAvatarSource,
  UserAvatarVisual,
} from "@/app/lib/user-avatar-display";

/** Controlled set of icons a user avatar may render. */
const USER_AVATAR_ICONS = {
  rocket: Rocket,
  star: Star,
  user: UserRound,
} as const satisfies Record<UserAvatarIconKey, unknown>;

const USER_AVATAR_SIZES = {
  xs: {
    container: "size-6 text-[11px] font-semibold",
    icon: "size-3.5",
    ring: "border-[1.5px]",
  },
  sm: {
    container: "size-7 text-xs font-semibold",
    icon: "size-4",
    ring: "border-2",
  },
  md: {
    container: "size-9 text-sm font-medium",
    icon: "size-5",
    ring: "border-2",
  },
  lg: {
    container: "size-12 text-lg font-semibold",
    icon: "size-6",
    ring: "border-[2.5px]",
  },
  xl: {
    container: "size-24 text-3xl font-semibold",
    icon: "size-12",
    ring: "border-4",
  },
} as const;

type UserAvatarSize = keyof typeof USER_AVATAR_SIZES;

interface UserAvatarProps extends UserAvatarSource {
  readonly size?: UserAvatarSize;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly title?: string;
}

interface UserAvatarContentProps {
  readonly visual: UserAvatarVisual;
  readonly iconClassName: string;
  readonly onImageError: () => void;
}

/** Renders the image, icon or initials an avatar shows. */
function UserAvatarContent({
  visual,
  iconClassName,
  onImageError,
}: UserAvatarContentProps): React.ReactElement {
  if (visual.kind === "image") {
    return (
      <img
        className="size-full rounded-full object-cover"
        src={visual.imageUrl}
        alt=""
        draggable={false}
        onError={onImageError}
      />
    );
  }

  if (visual.kind === "icon") {
    const IconComponent = USER_AVATAR_ICONS[visual.iconKey];

    return (
      <IconComponent
        className={cn("shrink-0", iconClassName)}
        aria-hidden="true"
      />
    );
  }

  return <>{visual.initials}</>;
}

interface AvatarRingProps {
  /** The person color as stored, `#rrggbb`. */
  readonly color: string;
  /** The border width class that fits the avatar size. */
  readonly widthClassName: string;
}

/**
 * The ring of a person color around an avatar (PAGE-266).
 *
 * @remarks
 * The ring lies on top of the avatar and inside its circle, so no
 * surrounding area cuts it off and it covers the edge of an image as well.
 * The stylesheet keeps it visible in the dark theme. Decorative only.
 */
export function AvatarRing({
  color,
  widthClassName,
}: AvatarRingProps): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pages-user-color-ring pointer-events-none absolute inset-0 rounded-full border-solid",
        widthClassName,
      )}
      style={createUserRingStyle(color)}
    />
  );
}

/**
 * Renders a user's avatar with image, icon, and initials fallback support.
 *
 * @remarks
 * A chosen person color draws a ring around the avatar and the initials in
 * that color (PAGE-266); without one the avatar keeps its former look.
 */
export function UserAvatar({
  size = "md",
  className,
  ariaLabel,
  title,
  ...source
}: UserAvatarProps): React.ReactElement {
  const [hasImageError, setHasImageError] = useState(false);
  const avatar = resolveUserAvatar(source);
  const visual = getUserAvatarVisual(avatar, hasImageError);
  const sizeClasses = USER_AVATAR_SIZES[size];

  useEffect(() => {
    setHasImageError(false);
  }, [avatar.imageUrl]);

  function handleImageError(): void {
    setHasImageError(true);
  }

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        sizeClasses.container,
        visual.kind === "initials"
          ? avatar.placeholderColorClasses
          : "bg-muted text-muted-foreground",
        avatar.customColor !== null && "pages-user-color-text",
        className,
      )}
      style={
        avatar.customColor === null
          ? undefined
          : createUserTextColorStyle(avatar.customColor)
      }
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      title={title}
    >
      <UserAvatarContent
        visual={visual}
        iconClassName={sizeClasses.icon}
        onImageError={handleImageError}
      />
      {avatar.customColor === null ? null : (
        <AvatarRing
          color={avatar.customColor}
          widthClassName={sizeClasses.ring}
        />
      )}
    </span>
  );
}
