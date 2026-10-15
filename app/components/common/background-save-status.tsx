import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useDraftStores } from "./draft-provider";

import type { DraftEntry, DraftQueue } from "@/app/lib/drafts/draft-queue";

interface SaveNotice {
  readonly id: string;
  readonly href: string;
  readonly label: string;
  readonly status: string;
  readonly retry: (() => void) | null;
}

function toNotices<T>(queue: DraftQueue<T>, prefix: string): SaveNotice[] {
  return queue
    .list()
    .filter((entry) => entry.hasEdited)
    .map((entry) => ({
      id: `${prefix}:${entry.id}`,
      href: entry.href,
      label: entry.label,
      status: statusOf(entry),
      retry: entry.error && !entry.current ? () => queue.save(entry.id) : null,
    }));
}

function statusOf<T>(entry: DraftEntry<T>): string {
  if (entry.current) return "conflict";
  if (entry.error) return "error";
  if (entry.isSaving) return "saving";
  return entry.hasChanges ? "unsaved" : "saved";
}

/** Keeps saving, failures and links back to retained drafts visible in every area. */
export function BackgroundSaveStatus(): React.ReactElement | null {
  const { t } = useTranslation();
  const stores = useDraftStores();
  const notices = [
    ...toNotices(stores.wiki, "wiki"),
    ...toNotices(stores.descriptions, "ticket"),
  ];
  if (notices.length === 0) return null;
  const active = notices.filter((entry) => entry.status !== "saved");
  if (active.length === 0) {
    return (
      <p className="mb-3 text-xs text-muted-foreground" role="status">
        {t("backgroundSave.saved")}
      </p>
    );
  }
  return (
    <ul
      aria-live="polite"
      className="mb-4 space-y-1 text-xs text-muted-foreground"
    >
      {active.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center gap-2"
          role="status"
        >
          <Link className="underline" to={entry.href}>
            {entry.label}
          </Link>
          <span>{t(`backgroundSave.${entry.status}`)}</span>
          {entry.retry ? (
            <button
              type="button"
              className="font-medium text-primary underline"
              onClick={entry.retry}
            >
              {t("backgroundSave.retry")}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
