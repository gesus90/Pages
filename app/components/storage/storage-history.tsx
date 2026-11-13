import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const historySchema = z.object({
  ok: z.literal(true),
  result: z.array(
    z.object({
      actorId: z.string(),
      actorName: z.string(),
      operation: z.string(),
      ref: z.string(),
      createdAt: z.string(),
    }),
  ),
});

/** Shows the acting names of successful Storage actions; ordinary accounts see their own history. */
export function StorageHistory(): React.ReactElement {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<
    z.infer<typeof historySchema>["result"]
  >([]);
  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch("/storage-api/access?view=history", {
          signal: controller.signal,
        });
        const parsed = historySchema.safeParse(await response.json());
        if (response.ok && parsed.success) setEntries(parsed.data.result);
      } catch {
        if (!controller.signal.aborted) setEntries([]);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  return (
    <details className="rounded-md border border-border p-3 text-sm">
      <summary>{t("storage.access.history")}</summary>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map((entry, index) => (
          <li key={`${entry.createdAt}:${index}`}>
            <strong>{entry.actorName}</strong> ·{" "}
            {t(`storage.access.operations.${entry.operation}`, {
              defaultValue: entry.operation,
            })}{" "}
            · {entry.ref} · <time>{entry.createdAt}</time>
          </li>
        ))}
      </ul>
    </details>
  );
}
