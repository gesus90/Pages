import type { VirtualParticipantColor } from "@/definition/VirtualChat";

/** Tailwind classes of one participant color in its three steps. */
export interface ParticipantColorClasses {
  /** The light `-subtle` step as background, for bubbles and avatars. */
  readonly surface: string;
  /** The full color at 30 % opacity as border. */
  readonly border: string;
  /** The full color as text, for names and initials. */
  readonly text: string;
}

const PARTICIPANT_COLORS: Record<
  VirtualParticipantColor,
  ParticipantColorClasses
> = {
  primary: {
    surface: "bg-primary-subtle",
    border: "border-primary/30",
    text: "text-primary",
  },
  indigo: {
    surface: "bg-participant-indigo-subtle",
    border: "border-participant-indigo/30",
    text: "text-participant-indigo",
  },
  pink: {
    surface: "bg-participant-pink-subtle",
    border: "border-participant-pink/30",
    text: "text-participant-pink",
  },
  teal: {
    surface: "bg-participant-teal-subtle",
    border: "border-participant-teal/30",
    text: "text-participant-teal",
  },
  lime: {
    surface: "bg-participant-lime-subtle",
    border: "border-participant-lime/30",
    text: "text-participant-lime",
  },
};

/**
 * Resolves a participant color to its semantic token classes; the one place
 * that turns a color into classes on the chat page.
 *
 * @remarks
 * Later the color comes from the person or agent; only this function then
 * learns the new source and keeps returning the same three steps.
 */
export function participantColors(
  color: VirtualParticipantColor,
): ParticipantColorClasses {
  return PARTICIPANT_COLORS[color];
}
