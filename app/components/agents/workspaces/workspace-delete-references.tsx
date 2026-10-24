import { useTranslation } from "react-i18next";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import type {
  AgentWorkspaceUsage,
  AgentWorkspaceUsageKind,
} from "@/definition/AgentWorkspace";

interface UsageEntry {
  readonly key: string;
  readonly kind: AgentWorkspaceUsageKind;
  readonly name: string | null;
  readonly count: number;
}

/** Keeps named references as they are and counts the anonymous ones per kind. */
function toUsageEntries(
  usages: readonly AgentWorkspaceUsage[],
): readonly UsageEntry[] {
  const entries: UsageEntry[] = [];
  const anonymous = new Map<AgentWorkspaceUsageKind, number>();
  for (const usage of usages) {
    if (usage.name !== null)
      entries.push({
        key: `${usage.kind}:${usage.id}`,
        kind: usage.kind,
        name: usage.name,
        count: 1,
      });
    else anonymous.set(usage.kind, (anonymous.get(usage.kind) ?? 0) + 1);
  }
  for (const [kind, count] of anonymous)
    entries.push({ key: kind, kind, name: null, count });
  return entries;
}

function UsageLabel({
  entry,
}: {
  readonly entry: UsageEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  if (entry.name !== null) return <>{entry.name}</>;
  const kind = t(`workspaces.usageKind.${entry.kind}`);
  return (
    <>
      {entry.count > 1
        ? t("workspaces.usageKindCount", { kind, count: entry.count })
        : kind}
    </>
  );
}

/** Lists affected records and explains the active-run refusal under the existing privacy rules. */
export function WorkspaceDeleteReferences({
  usages,
}: {
  readonly usages: readonly AgentWorkspaceUsage[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (usages.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-warning">
        {t("workspaces.detachDescription")}
      </p>
      <VerticalScrollArea className="max-h-44" contentClassName="pb-2">
        <p className="text-sm font-medium">{t("workspaces.usedBy")}</p>
        <ul className="pages-selectable mt-2 space-y-1 text-sm wrap-anywhere">
          {toUsageEntries(usages).map((entry) => (
            <li key={entry.key}>
              <UsageLabel entry={entry} />
            </li>
          ))}
        </ul>
      </VerticalScrollArea>
      {usages.some((usage) => usage.kind === "run") ? (
        <p role="alert" className="text-sm text-destructive">
          {t("settings.agents.error.workspace_running")}
        </p>
      ) : null}
    </div>
  );
}
