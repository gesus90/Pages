import { Rocket, Star, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/app/lib/cn";
import {
  getUserAvatarVisual,
  resolveUserAvatar,
} from "@/app/lib/user-avatar-display";

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

/** Renders a user's avatar with image, icon, and initials fallback support. */
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
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        sizeClasses.container,
        visual.kind === "initials"
          ? avatar.placeholderColorClasses
          : "bg-muted text-muted-foreground",
        className,
      )}
      style={avatar.customColor ? { color: avatar.customColor } : undefined}
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
    </span>
  );
}
