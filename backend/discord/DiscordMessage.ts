import { isDiscordEventType } from "@/definition/Discord";

import type { DiscordMessageBody } from "@/backend/discord/DiscordApiClient";
import type { DiscordEventType } from "@/definition/Discord";

const ZERO_WIDTH_SPACE = "\u200B";
const MAXIMUM_TEXT_LENGTH = 160;
// Invisible and direction-changing characters would let a title imitate other text.
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

const EVENT_LABELS: Readonly<Record<DiscordEventType, string>> = {
  "milestone.created": "Milestone created",
  "milestone.updated": "Milestone updated",
  "ticket.created": "Ticket created",
  "ticket.updated": "Ticket updated",
};

/**
 * The facts a notification states, stored in the outbox until it is sent.
 *
 * @remarks
 * Only what the message shows: no description, no person and no comment text.
 */
export interface DiscordNotificationContent {
  readonly event: DiscordEventType;
  readonly projectName: string;
  /** The ticket key, for example `PAGE-12`; `null` for a milestone. */
  readonly reference: string | null;
  readonly title: string;
  readonly status: string | null;
  /** Link to the ticket or the planning of the project in Pages. */
  readonly url: string;
}

/**
 * Makes a text from a user safe to show in a Discord message.
 *
 * @param text - Title or name that anyone with write access chose.
 * @returns One line of at most 160 characters in which nothing can ping
 * someone, mention a channel, format the message or form a link.
 *
 * @remarks
 * This is the second layer. The first is `allowed_mentions` with an empty
 * `parse` list on every message, which stops a ping even when this function
 * missed a form. Zero-width spaces break `@everyone`, `@here`, `<@user>`,
 * `<@&role>`, `<#channel>` and `scheme://` links; markdown characters are
 * escaped so a title cannot restyle the message or hide a link behind a label.
 */
export function neutralizeUntrustedText(text: string): string {
  const singleLine = [...text.replaceAll(INVISIBLE_CHARACTERS, "")]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim();
  const shortened =
    singleLine.length > MAXIMUM_TEXT_LENGTH
      ? `${singleLine.slice(0, MAXIMUM_TEXT_LENGTH - 1)}…`
      : singleLine;

  return shortened
    .replaceAll("@", `@${ZERO_WIDTH_SPACE}`)
    .replaceAll("<", `<${ZERO_WIDTH_SPACE}`)
    .replaceAll("://", `:${ZERO_WIDTH_SPACE}//`)
    .replaceAll(/[\\*_~|`>[\]()]/g, "\\$&");
}

/**
 * Builds the Discord message of a notification.
 *
 * @param content - The stored facts of the event.
 * @returns A short message with the event, the item, the project and the Pages
 * link; mentions are disabled for every kind of target.
 */
export function buildNotificationMessage(
  content: DiscordNotificationContent,
): DiscordMessageBody {
  const heading = [
    `**${EVENT_LABELS[content.event]}**`,
    content.reference === null
      ? null
      : neutralizeUntrustedText(content.reference),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const details = [
    `Project: ${neutralizeUntrustedText(content.projectName)}`,
    content.status === null
      ? null
      : `Status: ${neutralizeUntrustedText(content.status)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return {
    allowed_mentions: { parse: [] },
    content: [
      heading,
      // The invisible character keeps a title such as "# x" or "- x" from
      // starting a heading or a list at the beginning of its line.
      `${ZERO_WIDTH_SPACE}${neutralizeUntrustedText(content.title)}`,
      details,
      content.url,
    ].join("\n"),
    flags: 4,
  };
}

/**
 * Builds the message of the connection test.
 *
 * @param projectName - Name of the project that is being connected.
 * @param url - Link to the project in Pages.
 * @returns A message that says where it comes from.
 */
export function buildTestMessage(
  projectName: string,
  url: string,
): DiscordMessageBody {
  return {
    allowed_mentions: { parse: [] },
    content: [
      "**Pages test message**",
      `This channel receives notifications of the project ${neutralizeUntrustedText(projectName)}.`,
      url,
    ].join("\n"),
    flags: 4,
  };
}

function readText(value: object, field: string): string | null {
  const text: unknown = Reflect.get(value, field);

  return typeof text === "string" ? text : null;
}

/**
 * Reads the stored facts of a notification back.
 *
 * @param json - Text stored in the outbox.
 * @returns The facts, or `null` when the text is not a valid notification.
 */
export function parseNotificationContent(
  json: string,
): DiscordNotificationContent | null {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const event = readText(value, "event");
  const projectName = readText(value, "projectName");
  const title = readText(value, "title");
  const url = readText(value, "url");

  if (
    !isDiscordEventType(event) ||
    projectName === null ||
    title === null ||
    url === null
  ) {
    return null;
  }

  return {
    event,
    projectName,
    reference: readText(value, "reference"),
    status: readText(value, "status"),
    title,
    url,
  };
}
