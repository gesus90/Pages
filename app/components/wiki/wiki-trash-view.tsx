import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { WikiActionDialog } from "@/app/components/wiki/wiki-action-dialog";

import type { WikiTrashEntry } from "@/backend/database/repositories/WikiRepository";

/** A deleted page with the days that remain before it is removed for good. */
export interface WikiTrashItem extends WikiTrashEntry {
  readonly daysLeft: number;
}

interface TrashChoice {
  readonly kind: "restore" | "purge";
  readonly entry: WikiTrashItem;
}

/** The trash: deleted pages with their remaining time, restore and delete. */
export function WikiTrashView({
  entries,
}: {
  readonly entries: readonly WikiTrashItem[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const [choice, setChoice] = useState<TrashChoice | null>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("wiki.trash.title")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("wiki.trash.description")}
      </p>
      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
          {t("wiki.trash.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2">{t("wiki.home.columnTitle")}</th>
                <th className="px-3 py-2">{t("wiki.trash.deleted")}</th>
                <th className="px-3 py-2">{t("wiki.trash.remaining")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {entry.icon ? `${entry.icon} ` : ""}
                    {entry.title}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDateTime(entry.deletedAt)}
                    {entry.deletedByName ? ` · ${entry.deletedByName}` : ""}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t("wiki.trash.daysLeft", { count: entry.daysLeft })}
                  </td>
                  <td className="flex justify-end gap-2 px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setChoice({ entry, kind: "restore" })}
                    >
                      {t("wiki.trash.restore")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setChoice({ entry, kind: "purge" })}
                    >
                      {t("wiki.trash.purge")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {choice ? (
        <WikiActionDialog
          action="/wiki"
          description={t(`wiki.trash.${choice.kind}Description`)}
          fields={{ intent: `${choice.kind}-page`, pageId: choice.entry.id }}
          isDestructive={choice.kind === "purge"}
          submitLabel={t(`wiki.trash.${choice.kind}`)}
          title={t(`wiki.trash.${choice.kind}Title`, {
            title: choice.entry.title,
          })}
          onClose={() => setChoice(null)}
        />
      ) : null}
    </div>
  );
}
