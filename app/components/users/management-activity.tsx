import { useTranslation } from "react-i18next";

/** Credential-free history shown only in an administrator's server-authorized page data. */
export interface ManagementActivityEntry {
  readonly id: string;
  readonly actorId: string;
  readonly at: string;
  readonly action: string;
  readonly target: string;
  readonly change: string;
}
/** Renders the actor, timestamp, target and persisted change without new theme colors. */
export function ManagementActivity({
  entries,
}: {
  readonly entries: readonly ManagementActivityEntry[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="p-3 text-left font-medium">
          {t("users.management.activity")}
        </caption>
        <thead>
          <tr>
            {["at", "actor", "action", "target", "change"].map((column) => (
              <th key={column} className="p-3 text-muted-foreground">
                {t(`users.management.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-border">
              <td className="p-3">
                <time dateTime={entry.at}>{entry.at}</time>
              </td>
              <td className="p-3">{entry.actorId}</td>
              <td className="p-3">{entry.action}</td>
              <td className="p-3">{entry.target}</td>
              <td className="p-3">
                <details>
                  <summary>{t("users.management.change")}</summary>
                  <pre className="max-w-lg whitespace-pre-wrap break-words">
                    {entry.change}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
