import { Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ParticipantAvatar } from "../chat-page-avatar";

import type { MentionChoice } from "./mention-choices";
import type { MentionEditor } from "./use-mention-editor";

/** Bold matching letters without interpreting names as HTML. */
export function MentionMatch({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): React.ReactElement {
  const start =
    query === "" ? -1 : text.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <strong>{text.slice(start, start + query.length)}</strong>
      {text.slice(start + query.length)}
    </>
  );
}

function MentionAvatar({
  choice,
}: {
  readonly choice: MentionChoice;
}): React.ReactElement {
  if (choice.section !== "aliases")
    return (
      <ParticipantAvatar
        size={28}
        participant={{
          name: choice.name,
          color: choice.color ?? null,
          avatarImageUrl: choice.avatarImageUrl ?? null,
        }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-status-active"
    >
      <Users className="size-4" />
    </span>
  );
}

function MentionRow({
  choice,
  index,
  input,
}: {
  readonly choice: MentionChoice;
  readonly index: number;
  readonly input: MentionEditor;
}): React.ReactElement {
  const { t } = useTranslation();
  const selectedRef = useRef<HTMLLIElement>(null);
  const isSelected = index === input.selected;
  useEffect(() => {
    if (isSelected) selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);
  let scope = choice.role;
  if (!choice.isSelectable) scope = t("chatPage.mentions.cannotAnswer");
  else if (choice.section === "aliases")
    scope = t("chatPage.mentions.agents", { count: choice.count });
  return (
    <li
      ref={selectedRef}
      id={`${input.listId}-${index}`}
      role="option"
      aria-selected={isSelected}
      aria-disabled={!choice.isSelectable}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (choice.isSelectable) input.select(index);
      }}
      onClick={() => input.choose(choice)}
      className={cn(
        "flex h-11 items-center gap-2 rounded-lg px-2",
        isSelected && "bg-sidebar-hover",
        choice.isSelectable
          ? "cursor-pointer"
          : "text-muted-foreground opacity-50",
      )}
    >
      <MentionAvatar choice={choice} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-sm font-medium">
          <MentionMatch text={choice.name} query={input.query?.query ?? ""} />
        </span>{" "}
        <span className="text-[13px] text-muted-foreground">
          {choice.section !== "aliases" ? (
            <MentionMatch
              text={`@${choice.username}`}
              query={input.query?.query ?? ""}
            />
          ) : null}
          {choice.alternatives.map((name) => (
            <span key={name}>
              {" "}
              ·{" "}
              <MentionMatch
                text={`@${name}`}
                query={input.query?.query ?? ""}
              />
            </span>
          ))}
        </span>
      </span>
      <span className="max-w-36 text-right text-xs text-muted-foreground">
        {scope}
      </span>
    </li>
  );
}

/** Anchors above the typed @; only the options scroll, with keyboard hints below. */
export function MentionPicker({
  input,
}: {
  readonly input: MentionEditor;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!input.query) return null;
  const width = Math.min(380, window.innerWidth - 16);
  const listHeight = Math.max(
    44,
    Math.min(352, window.innerHeight - input.query.bottom - 54),
  );
  const left = Math.max(
    8,
    Math.min(input.query.left, window.innerWidth - width - 8),
  );
  return createPortal(
    <div
      className="fixed z-50 rounded-2xl border border-border bg-surface p-1.5 text-foreground shadow-panel"
      style={{ left, width, bottom: input.query.bottom }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <ul
        id={input.listId}
        role="listbox"
        aria-label={t("chatPage.mentions.label")}
        className="max-h-[352px] overflow-y-auto"
        style={{ maxHeight: listHeight }}
      >
        {input.choices.map((choice, index) => (
          <MentionSection
            key={choice.key}
            choice={choice}
            index={index}
            input={input}
          />
        ))}
        {input.choices.length === 0 ? (
          <li
            role="presentation"
            className="px-4 py-3 text-sm text-muted-foreground"
          >
            {t("chatPage.mentions.noMatch", { query: input.query.query })}
          </li>
        ) : null}
      </ul>
      <p className="mt-1 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
        {t("chatPage.mentions.keys")}
      </p>
    </div>,
    document.body,
  );
}

function MentionSection({
  choice,
  index,
  input,
}: {
  readonly choice: MentionChoice;
  readonly index: number;
  readonly input: MentionEditor;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {input.choices[index - 1]?.section !== choice.section ? (
        <li
          role="presentation"
          className="px-2 py-1.5 text-[11px] font-medium uppercase text-muted-foreground"
        >
          {t(`chatPage.mentions.${choice.section}`)}
        </li>
      ) : null}
      <MentionRow choice={choice} index={index} input={input} />
    </>
  );
}
