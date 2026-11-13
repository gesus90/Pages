import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CALENDAR_LIMITS } from "@/definition/Calendar";

import { inviteeName } from "./calendar-entry-block";
import { useCalendarMutation } from "./use-calendar-mutation";

import type { CalendarInviteeChoice } from "./calendar-page-data";

interface CalendarInviteePickerProps {
  readonly invitees: readonly CalendarInviteeChoice[];
  readonly onChange: (invitees: readonly CalendarInviteeChoice[]) => void;
}

/** Waits this long after typing before the server is asked. */
const SEARCH_DELAY_MS = 250;

function keyOf(invitee: CalendarInviteeChoice): string {
  return `${invitee.kind}:${invitee.id}`;
}

/**
 * „Eingeladen“: the chosen people, agents, groups and departments as chips
 * and a search field that asks the server whom the account may invite.
 */
export function CalendarInviteePicker({
  invitees,
  onChange,
}: CalendarInviteePickerProps): React.ReactElement {
  const { t } = useTranslation();
  const search = useCalendarMutation();
  const [query, setQuery] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const inputId = useId();
  const listId = useId();
  const chosen = new Set(invitees.map(keyOf));
  const result = search.result;
  const found = result !== null && result.ok ? (result.invitees ?? []) : [];
  const choices =
    query.trim() === ""
      ? []
      : found.filter((choice) => !chosen.has(keyOf(choice)));

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleQuery(text: string): void {
    setQuery(text);
    window.clearTimeout(timer.current);
    if (text.trim() === "") return;
    timer.current = window.setTimeout(() => {
      search.submit("search-invitees", { text: text.trim() });
    }, SEARCH_DELAY_MS);
  }

  function add(choice: CalendarInviteeChoice): void {
    if (invitees.length >= CALENDAR_LIMITS.invitees) return;
    onChange([...invitees, choice]);
    setQuery("");
  }

  function remove(invitee: CalendarInviteeChoice): void {
    onChange(invitees.filter((known) => keyOf(known) !== keyOf(invitee)));
  }

  return (
    <div className="relative">
      <label
        className="text-xs font-medium text-muted-foreground"
        htmlFor={inputId}
      >
        {t("calendar.form.invitees")}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-xl bg-surface px-2 py-1.5 shadow-field">
        {invitees.map((invitee) => (
          <span
            key={keyOf(invitee)}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
          >
            {inviteeName(invitee, t)}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("calendar.form.removeInvitee", {
                name: invitee.name,
              })}
              onClick={() => remove(invitee)}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          role="combobox"
          aria-expanded={choices.length > 0}
          aria-controls={listId}
          autoComplete="off"
          className="min-w-32 flex-1 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t("calendar.form.addInvitee")}
          value={query}
          onChange={(event) => handleQuery(event.target.value)}
        />
      </div>
      {choices.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl bg-surface p-1 shadow-panel"
        >
          {choices.map((choice) => (
            <li key={keyOf(choice)} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-foreground hover:bg-surface-hover"
                onClick={() => add(choice)}
              >
                {inviteeName(choice, t)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
