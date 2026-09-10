import { cn } from "@/app/lib/cn";

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

interface AvatarSubject {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

/**
 * Returns the single letter shown inside a user's avatar.
 *
 * @param user - User the avatar represents.
 */
export function getAvatarInitial(user: AvatarSubject): string {
  return (user.displayName.trim() || user.username).charAt(0).toUpperCase();
}

function pickPaletteEntry(userId: string): string {
  const codePointSum = Array.from(userId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return AVATAR_PALETTE[codePointSum % AVATAR_PALETTE.length];
}

interface UserAvatarProps {
  readonly user: AvatarSubject;
  readonly className?: string;
}

/** Renders a user's automatically generated initial avatar. */
export function UserAvatar({
  user,
  className,
}: UserAvatarProps): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 select-none items-center justify-center rounded-full text-sm font-medium",
        pickPaletteEntry(user.id),
        className,
      )}
      aria-hidden="true"
    >
      {getAvatarInitial(user)}
    </span>
  );
}
