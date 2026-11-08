import { PicaMascot } from "@/app/components/chat/pica-mascot";
import { cn } from "@/app/lib/cn";

import { participantColors } from "./chat-page-colors";

import type {
  VirtualParticipant,
  VirtualParticipantStatus,
} from "@/definition/VirtualChat";

/** Pixel sizes of avatars on the chat page. */
type AvatarSize = 22 | 26 | 32 | 40;

const AVATAR_SIZES: Record<AvatarSize, string> = {
  22: "size-5.5 text-[11px]",
  26: "size-6.5 text-xs",
  32: "size-8 text-sm",
  40: "size-10 text-base",
};

const STATUS_COLORS: Record<VirtualParticipantStatus, string> = {
  active: "bg-success",
  working: "bg-warning",
  off: "bg-muted-foreground",
};

interface ParticipantAvatarProps {
  readonly participant: VirtualParticipant;
  readonly size: AvatarSize;
  /** Draws a ring in the surface color, for avatars that overlap. */
  readonly hasRing?: boolean;
  readonly className?: string;
}

/**
 * A round participant avatar: the initial on a light tint of the
 * participant's color, or Pica's mascot.
 *
 * @remarks
 * Decorative; the name next to it names the participant.
 */
export function ParticipantAvatar({
  participant,
  size,
  hasRing = false,
  className,
}: ParticipantAvatarProps): React.ReactElement {
  const colors = participantColors(participant.color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        AVATAR_SIZES[size],
        participant.avatar === "pica"
          ? "bg-transparent"
          : [colors.surface, colors.text],
        hasRing && "ring-2 ring-surface",
        className,
      )}
    >
      {participant.avatar === "pica" ? (
        <PicaMascot className="size-full" />
      ) : (
        participant.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/** A 40 px participant avatar with its status point at the lower right. */
export function ParticipantStatusAvatar({
  participant,
}: {
  readonly participant: VirtualParticipant;
}): React.ReactElement {
  return (
    <span className="relative inline-flex shrink-0">
      <ParticipantAvatar participant={participant} size={40} />
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-surface",
          STATUS_COLORS[participant.status],
        )}
      />
    </span>
  );
}

/** Up to two overlapping member avatars of a group, the second one offset. */
export function GroupAvatars({
  members,
  size,
}: {
  readonly members: readonly VirtualParticipant[];
  readonly size: "list" | "header";
}): React.ReactElement {
  const [first, second] = members;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative shrink-0",
        size === "list" ? "size-9" : "size-10",
      )}
    >
      {first ? (
        <ParticipantAvatar
          participant={first}
          size={26}
          hasRing
          className="absolute top-0 left-0"
        />
      ) : null}
      {second ? (
        <ParticipantAvatar
          participant={second}
          size={26}
          hasRing
          className="absolute right-0 bottom-0"
        />
      ) : null}
    </span>
  );
}
