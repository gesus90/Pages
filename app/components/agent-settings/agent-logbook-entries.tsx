import { Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { AGENT_LOGBOOK_KINDS } from "@/definition/AgentLogbook";

import {
  ALL_ENTRIES,
  filterLogbookEntries,
  logbookChatKey,
  logbookChatName,
} from "./agent-logbook-display";

import type { AgentLogbookFilter } from "./agent-logbook-display";
import type {
  AgentLogbookChatOption,
  AgentLogbookEntryView,
  AgentLogbookKind,
} from "@/definition/AgentLogbook";

const COLUMNS = ["time", "chat", "kind", "entry", "origin", "actions"] as const;

function isKind(value: string): value is AgentLogbookKind {
  return AGENT_LOGBOOK_KINDS.some((kind) => kind === value);
}

interface ToolbarProps {
  readonly filter: AgentLogbookFilter;
  readonly chats: readonly AgentLogbookChatOption[];
  readonly onChange: (filter: AgentLogbookFilter) => void;
}

/** The search entry and the filters by kind and chat. */
function EntriesToolbar({
  filter,
  chats,
  onChange,
}: ToolbarProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={t("agentLogbook.search.label")}
          className="pl-9"
          onChange={(event) =>
            onChange({ ...filter, query: event.currentTarget.value })
          }
          placeholder={t("agentLogbook.search.placeholder")}
          type="search"
          value={filter.query}
        />
      </div>
      <Select
        ariaLabel={t("agentLogbook.filter.kind")}
        onValueChange={(value) =>
          onChange({ ...filter, kind: isKind(value) ? value : ALL_ENTRIES })
        }
        options={[
          { value: ALL_ENTRIES, label: t("agentLogbook.filter.allKinds") },
          ...AGENT_LOGBOOK_KINDS.map((kind) => ({
            value: kind,
            label: t(`agentLogbook.kind.${kind}`),
          })),
        ]}
        value={filter.kind}
      />
      <Select
        ariaLabel={t("agentLogbook.filter.chat")}
        onValueChange={(value) => onChange({ ...filter, chat: value })}
        options={[
          { value: ALL_ENTRIES, label: t("agentLogbook.filter.allChats") },
          ...chats.map((chat) => ({
            value: logbookChatKey(chat),
            label: logbookChatName(chat, t),
          })),
        ]}
        value={filter.chat}
      />
    </div>
  );
}

interface EntryRowProps {
  readonly entry: AgentLogbookEntryView;
  readonly isBusy: boolean;
  readonly isRemoving: boolean;
  readonly onRemove: (entryId: string) => void;
}

/** One entry: time, chat, kind, text with the people involved, origin and the button to remove it. */
function EntryRow({
  entry,
  isBusy,
  isRemoving,
  onRemove,
}: EntryRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <tr className="border-t border-border/60 align-top">
      <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {formatDateTime(entry.at)}
      </td>
      <td className="px-3 py-3 text-sm font-medium text-foreground">
        {logbookChatName(entry.source, t)}
      </td>
      <td className="px-3 py-3">
        <span className="rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
          {t(`agentLogbook.kind.${entry.kind}`)}
        </span>
      </td>
      <td className="px-3 py-3">
        <p className="text-sm break-words text-foreground">{entry.text}</p>
        {entry.participants.length === 0 ? null : (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("agentLogbook.participants", {
              names: entry.participants.join(", "),
            })}
          </p>
        )}
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground">
        {t(`agentLogbook.origin.${entry.origin}`)}
      </td>
      <td className="px-3 py-3">
        <Button
          aria-label={t("agentLogbook.removeFor", { topic: entry.topic })}
          disabled={isBusy}
          isPending={isRemoving}
          onClick={() => onRemove(entry.id)}
          size="xs"
          variant="outline"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          {t("agentLogbook.remove")}
        </Button>
      </td>
    </tr>
  );
}

interface AgentLogbookEntriesProps {
  readonly agentName: string;
  readonly entries: readonly AgentLogbookEntryView[];
  readonly chats: readonly AgentLogbookChatOption[];
  /** Whether a change runs now; the buttons wait for it. */
  readonly isBusy: boolean;
  readonly onRemove: (entryId: string) => void;
}

/**
 * The entries of the Lagebuch with their search and the filters by kind and
 * chat, the newest first. The table scrolls sideways on narrow screens.
 */
export function AgentLogbookEntries({
  agentName,
  entries,
  chats,
  isBusy,
  onRemove,
}: AgentLogbookEntriesProps): React.ReactElement {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AgentLogbookFilter>({
    query: "",
    kind: ALL_ENTRIES,
    chat: ALL_ENTRIES,
  });
  const [removingId, setRemovingId] = useState<string | null>(null);
  const shown = filterLogbookEntries(entries, filter);

  function handleRemove(entryId: string): void {
    setRemovingId(entryId);
    onRemove(entryId);
  }

  return (
    <div className="flex flex-col gap-3">
      <EntriesToolbar filter={filter} chats={chats} onChange={setFilter} />
      <p className="text-xs text-muted-foreground" role="status">
        {t("agentLogbook.shown", {
          shown: shown.length,
          count: entries.length,
        })}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {entries.length === 0
            ? t("agentLogbook.empty")
            : t("agentLogbook.emptyFiltered")}
        </p>
      ) : (
        <HorizontalScrollArea className="rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              {t("agentLogbook.tableLabel", { name: agentName })}
            </caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    className="px-3 py-3 font-medium"
                    scope="col"
                  >
                    {t(`agentLogbook.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  isBusy={isBusy}
                  isRemoving={isBusy && removingId === entry.id}
                  onRemove={handleRemove}
                />
              ))}
            </tbody>
          </table>
        </HorizontalScrollArea>
      )}
    </div>
  );
}
