import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { jsonEntries, jsonKindOf } from "./json-parse";
import { copyText } from "./use-card-text";

import type { JsonValueKind } from "./json-parse";

/** Levels the tree shows expanded at first. */
const EXPANDED_DEPTH = 2;
/** Entries of one level shown before "weitere zeigen". */
const ENTRY_PAGE = 200;

/** The color token of each kind of value, as in the syntax colors. */
const KIND_CLASSES: Readonly<Record<JsonValueKind, string>> = {
  object: "text-muted-foreground",
  array: "text-muted-foreground",
  string: "text-code-string",
  number: "text-code-number",
  boolean: "text-code-keyword",
  null: "text-code-keyword italic",
};

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function primitiveLabel(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** Copies the value of a row; shown when the row is hovered or focused. */
function CopyValue({ value }: { readonly value: unknown }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <button
      className="ml-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/json:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100"
      onClick={() => copyText(valueText(value))}
      title={t("chatPage.preview.json.copyValue")}
      type="button"
    >
      <Copy aria-hidden="true" className="size-3" />
      <span className="sr-only">{t("chatPage.preview.json.copyValue")}</span>
    </button>
  );
}

interface JsonNodeProps {
  /** The key or index; `null` for the root. */
  readonly name: string | null;
  readonly value: unknown;
  readonly depth: number;
}

function NodeName({
  name,
}: {
  readonly name: string | null;
}): React.ReactElement | null {
  if (name === null) return null;
  return (
    <>
      <span className="text-code-function">{name}</span>
      <span className="text-muted-foreground">: </span>
    </>
  );
}

/** The entries of an open object or array, a page at a time. */
function JsonChildren({
  value,
  depth,
}: {
  readonly value: unknown;
  readonly depth: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const [shown, setShown] = useState(ENTRY_PAGE);
  const entries = jsonEntries(value);
  const rest = entries.length - shown;
  return (
    <ul className="ml-3 border-l border-border pl-2" role="group">
      {entries.slice(0, shown).map(([key, entry]) => (
        <JsonNode key={key} depth={depth + 1} name={key} value={entry} />
      ))}
      {rest > 0 ? (
        <li>
          <button
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShown(shown + ENTRY_PAGE)}
            type="button"
          >
            {t("chatPage.preview.json.more", { count: rest })}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** One entry of the tree: a value, or an object or array that opens and closes. */
function JsonNode({ name, value, depth }: JsonNodeProps): React.ReactElement {
  const { t } = useTranslation();
  const kind = jsonKindOf(value);
  const [isOpen, setOpen] = useState(depth < EXPANDED_DEPTH);
  if (kind !== "object" && kind !== "array")
    return (
      <li
        className="group/json flex items-center whitespace-pre-wrap"
        role="treeitem"
      >
        <NodeName name={name} />
        <span className={KIND_CLASSES[kind]}>{primitiveLabel(value)}</span>
        <CopyValue value={value} />
      </li>
    );
  const count = jsonEntries(value).length;
  const Toggle = isOpen ? ChevronDown : ChevronRight;
  const brackets = kind === "array" ? "[ ]" : "{ }";
  return (
    <li aria-expanded={isOpen} role="treeitem">
      <span className="group/json flex items-center">
        <button
          className="inline-flex items-center gap-0.5 rounded text-left hover:bg-surface-hover"
          onClick={() => setOpen(!isOpen)}
          type="button"
        >
          <Toggle
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground"
          />
          <NodeName name={name} />
          <span className={KIND_CLASSES[kind]}>{brackets}</span>
        </button>
        <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
          {t("chatPage.preview.json.entries", { count })}
        </span>
        <CopyValue value={value} />
      </span>
      {isOpen ? <JsonChildren depth={depth} value={value} /> : null}
    </li>
  );
}

/**
 * JSON as a tree that opens and closes: each kind of value in its
 * color, the number of entries at each object and array, and a copy button
 * for every value. Nothing of the JSON is executed.
 */
export function JsonTree({
  value,
  className,
}: {
  readonly value: unknown;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("chatPage.preview.json.tree")}
      className={cn(
        "pages-selectable overflow-auto bg-panel-body px-3 py-2.5 font-mono text-xs leading-[1.7] text-foreground",
        className,
      )}
      role="tree"
    >
      <JsonNode depth={0} name={null} value={value} />
    </ul>
  );
}
