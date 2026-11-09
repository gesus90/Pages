import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { ParticipantAvatar } from "./chat-page-avatar";

import type { TFunction } from "i18next";
import type { VirtualContactChoice } from "@/definition/VirtualChat";

interface ChatPageContactDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** People and agents the list can take; never the own account. */
  readonly choices: readonly VirtualContactChoice[];
  /** The account IDs in the list now. */
  readonly selectedIds: readonly string[];
}

function matches(choice: VirtualContactChoice, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return (
    needle === "" ||
    [choice.name, choice.subtitle].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    )
  );
}

/** A person shows the username, an agent its job title or that it is off. */
function choiceSubtitle(choice: VirtualContactChoice, t: TFunction): string {
  if (!choice.isSelectable) return t("chatPage.contacts.inactive");
  return choice.kind === "human"
    ? t("chatPage.username", { username: choice.subtitle })
    : choice.subtitle;
}

interface ChoiceRowProps {
  readonly choice: VirtualContactChoice;
  readonly isChecked: boolean;
  readonly onToggle: (id: string) => void;
}

/** One person or agent with its checkbox; a deactivated agent can only be removed. */
function ChoiceRow({
  choice,
  isChecked,
  onToggle,
}: ChoiceRowProps): React.ReactElement {
  const { t } = useTranslation();
  const isDisabled = !choice.isSelectable && !isChecked;
  return (
    <li>
      <label
        className={
          isDisabled
            ? "flex cursor-not-allowed items-center gap-3 rounded-lg px-2 py-2"
            : "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
        }
      >
        <ParticipantAvatar
          participant={choice}
          size={40}
          isFaded={!choice.isSelectable}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={
              choice.isSelectable
                ? "truncate text-[15px] font-semibold text-foreground"
                : "truncate text-[15px] font-semibold text-muted-foreground"
            }
          >
            {choice.name}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {choiceSubtitle(choice, t)}
          </span>
        </span>
        <Checkbox
          aria-label={choice.name}
          checked={isChecked}
          disabled={isDisabled}
          onChange={() => onToggle(choice.id)}
        />
      </label>
    </li>
  );
}

function ChoiceSection({
  title,
  choices,
  checked,
  onToggle,
}: {
  readonly title: string;
  readonly choices: readonly VirtualContactChoice[];
  readonly checked: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}): React.ReactElement | null {
  if (choices.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="px-2 pt-2 text-xs font-semibold text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col">
        {choices.map((choice) => (
          <ChoiceRow
            key={choice.id}
            choice={choice}
            isChecked={checked.has(choice.id)}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </section>
  );
}

/** Keeps the checked IDs and saves them as the person's list. */
function useContactSelection(
  selectedIds: readonly string[],
  isOpen: boolean,
  onSaved: () => void,
): {
  readonly checked: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
  readonly save: () => void;
  readonly isSaving: boolean;
  readonly hasFailed: boolean;
} {
  const fetcher = useFetcher<{ readonly ok: boolean }>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(selectedIds),
  );
  const isIdle = fetcher.state === "idle";
  const result = fetcher.data;
  const handled = useRef<unknown>(null);
  // The IDs as one value, so a new array with the same entries keeps the choice.
  const selectedKey = selectedIds.join("\n");

  useEffect(() => {
    if (isOpen)
      setChecked(new Set(selectedKey === "" ? [] : selectedKey.split("\n")));
  }, [isOpen, selectedKey]);
  useEffect(() => {
    // Every saved answer closes the dialog once, never again on a later opening.
    if (!isIdle || result?.ok !== true || handled.current === result) return;
    handled.current = result;
    onSaved();
  }, [isIdle, result, onSaved]);

  function toggle(id: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save(): void {
    const formData = new FormData();
    formData.set("intent", "save-contacts");
    // Kept entries keep their place; new ones follow in the order shown.
    formData.set(
      "contacts",
      JSON.stringify([
        ...selectedIds.filter((id) => checked.has(id)),
        ...[...checked].filter((id) => !selectedIds.includes(id)),
      ]),
    );
    void fetcher.submit(formData, { method: "post" });
  }

  return {
    checked,
    toggle,
    save,
    isSaving: !isIdle,
    hasFailed: isIdle && fetcher.data?.ok === false,
  };
}

/**
 * The dialog "Teilnehmer hinzufügen" (PAGE-266): a searchable choice of
 * existing people and agents for the person's own list.
 *
 * @remarks
 * Checking adds to the list, unchecking removes from it; neither creates nor
 * deletes an account or agent. A deactivated agent is shown but cannot be
 * chosen. New agents are created in the user administration, which the
 * dialog points to; it has no fields to create one.
 */
export function ChatPageContactDialog({
  isOpen,
  onOpenChange,
  choices,
  selectedIds,
}: ChatPageContactDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const selection = useContactSelection(selectedIds, isOpen, () =>
    onOpenChange(false),
  );
  const shown = choices.filter((choice) => matches(choice, query));

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.contacts.title")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("chatPage.contacts.description")}
        </DialogDescription>
        <label className="relative mt-5 block">
          <span className="sr-only">{t("chatPage.contacts.search")}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chatPage.contacts.search")}
            type="search"
            value={query}
          />
        </label>
        <div className="mt-3 flex max-h-[50dvh] flex-col gap-2 overflow-y-auto">
          <ChoiceSection
            title={t("chatPage.contacts.people")}
            choices={shown.filter((choice) => choice.kind === "human")}
            checked={selection.checked}
            onToggle={selection.toggle}
          />
          <ChoiceSection
            title={t("chatPage.contacts.agents")}
            choices={shown.filter((choice) => choice.kind === "agent")}
            checked={selection.checked}
            onToggle={selection.toggle}
          />
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("chatPage.noMatches")}
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("chatPage.contacts.newAgentsBefore")}{" "}
          <Link
            className="font-medium text-primary-text hover:underline"
            to="/users"
          >
            {t("chatPage.contacts.newAgentsLink")}
          </Link>{" "}
          {t("chatPage.contacts.newAgentsAfter")}
        </p>
        {selection.hasFailed ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t("chatPage.contacts.failed")}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t("chatPage.cancel")}</Button>
          </DialogClose>
          <Button isPending={selection.isSaving} onClick={selection.save}>
            {t("chatPage.contacts.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
