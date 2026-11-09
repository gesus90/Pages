import {
  createUserColorStyle,
  createUserTextColorStyle,
} from "@/app/lib/user-color-style";

import type { CSSProperties } from "react";

/** Classes and inline style of one colored element. */
export interface ColoredElement {
  readonly className: string;
  readonly style?: CSSProperties;
}

/** How a participant's color appears on the chat page. */
export interface ParticipantColorClasses {
  /** The answer bubble: a light tint and a border in the color. */
  readonly bubble: ColoredElement;
  /** The name above an answer and the initial of the avatar. */
  readonly text: ColoredElement;
}

/** The look of a participant without a chosen color: the former primary look. */
const DEFAULT_COLORS: ParticipantColorClasses = {
  bubble: { className: "bg-primary-subtle border-primary/30" },
  text: { className: "text-primary" },
};

/**
 * Resolves a participant's person color (PAGE-266) to what the chat page
 * draws: the one place that turns a color into classes and styles here.
 *
 * @remarks
 * A chosen color is a user-chosen color, so it is drawn directly: as a light
 * tint and a border of the bubble and, through the readable text class, as
 * the name color. Without a color the page keeps its primary look.
 */
export function participantColors(
  color: string | null,
): ParticipantColorClasses {
  if (color === null) return DEFAULT_COLORS;
  return {
    bubble: {
      className: "border-transparent",
      style: {
        ...createUserColorStyle(color, "14"),
        borderColor: `${color}4d`,
      },
    },
    text: {
      className: "pages-user-color-text",
      style: createUserTextColorStyle(color),
    },
  };
}
