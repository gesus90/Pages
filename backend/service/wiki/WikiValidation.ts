import { WikiValidationError } from "@/backend/error/WikiErrors";
import {
  countCharacters,
  normalizeWikiTitle,
  WIKI_LIMITS,
} from "@/definition/Wiki";

const EMOJI_PATTERN =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMUM_ICON_CODE_UNITS = 32;

/**
 * Checks and normalizes a page title.
 *
 * @param title - Title as typed.
 * @returns The title as a single line without surrounding blanks.
 * @throws {WikiValidationError} When it is empty or too long.
 */
export function normalizeTitle(title: string): string {
  const normalized = normalizeWikiTitle(title);

  if (normalized.length === 0) {
    throw new WikiValidationError("titleRequired");
  }

  if (countCharacters(normalized) > WIKI_LIMITS.titleLength) {
    throw new WikiValidationError("titleTooLong");
  }

  return normalized;
}

/**
 * Checks the text of a page.
 *
 * @param content - Markdown text.
 * @returns The same text.
 * @throws {WikiValidationError} When it is too long.
 */
export function validateContent(content: string): string {
  if (countCharacters(content) > WIKI_LIMITS.contentLength) {
    throw new WikiValidationError("contentTooLong");
  }

  return content;
}

/**
 * Checks the icon of a page.
 *
 * @param icon - A single emoji, or an empty value for none.
 * @returns The emoji, or `null` for none.
 * @throws {WikiValidationError} When it is not a single emoji.
 */
export function normalizeIcon(icon: string | null): string | null {
  const trimmed = icon?.trim() ?? "";

  if (trimmed.length === 0) {
    return null;
  }

  if (
    trimmed.length > MAXIMUM_ICON_CODE_UNITS ||
    !EMOJI_PATTERN.test(trimmed)
  ) {
    throw new WikiValidationError("invalidIcon");
  }

  return trimmed;
}

/**
 * Checks the date until which a page counts as up to date.
 *
 * @param date - Date as `YYYY-MM-DD`, or an empty value for none.
 * @returns The date, or `null` for none.
 * @throws {WikiValidationError} When it is not a real calendar date.
 */
export function normalizeDate(date: string | null): string | null {
  const trimmed = date?.trim() ?? "";

  if (trimmed.length === 0) {
    return null;
  }

  const parsed = new Date(`${trimmed}T00:00:00Z`);

  if (
    !DATE_PATTERN.test(trimmed) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new WikiValidationError("invalidDate");
  }

  return trimmed;
}
