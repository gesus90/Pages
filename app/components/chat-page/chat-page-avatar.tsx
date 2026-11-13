import { AvatarRing } from "@/app/components/common/user-avatar";
import { cn } from "@/app/lib/cn";

import { participantColors } from "./chat-page-colors";

import type {
  VirtualParticipant,
  VirtualParticipantStatus,
} from "@/definition/VirtualChat";

/** Pixel sizes of avatars on the chat page. */
type AvatarSize = 22 | 26 | 28 | 32 | 40;

const AVATAR_SIZES: Record<AvatarSize, { box: string; ring: string }> = {
  22: { box: "size-5.5 text-[11px]", ring: "border-[1.5px]" },
  26: { box: "size-6.5 text-xs", ring: "border-[1.5px]" },
  28: { box: "size-7 text-xs", ring: "border-2" },
  32: { box: "size-8 text-sm", ring: "border-2" },
  40: { box: "size-10 text-base", ring: "border-2" },
};

const STATUS_COLORS: Record<VirtualParticipantStatus, string> = {
  active: "bg-success",
  working: "bg-warning",
  off: "bg-muted-foreground",
};

/** What a participant avatar is drawn from. */
type AvatarParticipant = Pick<
  VirtualParticipant,
  "name" | "color" | "avatarImageUrl"
>;

interface ParticipantAvatarProps {
  readonly participant: AvatarParticipant;
  readonly size: AvatarSize;
  /** Draws an outline in the surface color, for avatars that overlap. */
  readonly hasOutline?: boolean;
  /** Draws a deactivated account faded. */
  readonly isFaded?: boolean;
  readonly className?: string;
}

/**
 * A round participant avatar: the image, or the initial in the person
 * color, with the ring of the person color around it (PAGE-266).
 *
 * @remarks
 * The ring is the one of the shared avatar, inside the circle, so it is
 * never cut off. Decorative; the name next to it names the participant.
 */
export function ParticipantAvatar({
  participant,
  size,
  hasOutline = false,
  isFaded = false,
  className,
}: ParticipantAvatarProps): React.ReactElement {
  const colors = participantColors(participant.color);
  const sizes = AVATAR_SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface font-semibold",
        sizes.box,
        participant.color === null
          ? "bg-muted text-muted-foreground"
          : colors.text.className,
        hasOutline && "ring-2 ring-surface",
        isFaded && "opacity-50",
        className,
      )}
      style={participant.color === null ? undefined : colors.text.style}
    >
      {participant.avatarImageUrl ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          src={participant.avatarImageUrl}
        />
      ) : (
        participant.name.slice(0, 1).toUpperCase()
      )}
      {participant.color === null ? null : (
        <AvatarRing color={participant.color} widthClassName={sizes.ring} />
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
          hasOutline
          className="absolute top-0 left-0"
        />
      ) : null}
      {second ? (
        <ParticipantAvatar
          participant={second}
          size={26}
          hasOutline
          className="absolute right-0 bottom-0"
        />
      ) : null}
    </span>
  );
}
