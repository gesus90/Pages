import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionGitState,
  AgentSessionReportedValue,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

interface ConsoleMetadataProps {
  readonly view: AgentSessionView;
  readonly record: AgentPlanSessionRecord;
  readonly lastActivity: string | null;
}

/** A long value keeps its end visible; the whole value is in the tooltip and can be copied. */
function LongValue({ value }: { readonly value: string }): React.ReactElement {
  const { t } = useTranslation();
  function copy(): void {
    void navigator.clipboard?.writeText(value).catch(() => undefined);
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span
        title={value}
        className="min-w-0 truncate font-mono text-xs [direction:rtl]"
      >
        <bdi>{value}</bdi>
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-6 shrink-0"
        onClick={copy}
        aria-label={t("plans.console.copy", { value })}
      >
        <Copy className="size-3" aria-hidden="true" />
      </Button>
    </span>
  );
}

function GitValue({
  git,
}: {
  readonly git: AgentSessionGitState | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (git === null) return <>{t("plans.console.unknown")}</>;
  if (git.state === "branch") return <LongValue value={git.branch} />;
  if (git.state === "detached")
    return (
      <>
        {t("plans.console.git.detached", { commit: git.commit.slice(0, 12) })}
      </>
    );
  return <>{t(`plans.console.git.${git.state}`)}</>;
}

function Reported({
  value,
}: {
  readonly value: AgentSessionReportedValue;
}): React.ReactElement {
  const { t } = useTranslation();
  return value.value === null ? (
    <span className="text-muted-foreground">{t("plans.console.unknown")}</span>
  ) : (
    <span className="break-all">{value.value}</span>
  );
}

/**
 * The checked directory, Git state, requested and confirmed model and reasoning, session and activity.
 *
 * @remarks
 * Every value comes from the backend view or the node's own record; a value
 * nobody reported reads as unknown instead of a guess.
 */
export function ConsoleMetadata({
  view,
  record,
  lastActivity,
}: ConsoleMetadataProps): React.ReactElement {
  const { t } = useTranslation();
  const unknown = (
    <span className="text-muted-foreground">{t("plans.console.unknown")}</span>
  );
  const rows: readonly [string, React.ReactNode][] = [
    [
      "directory",
      view.workspace ? <LongValue value={view.workspace.directory} /> : unknown,
    ],
    ["branch", <GitValue key="git" git={view.workspace?.git ?? null} />],
    ["requestedModel", <Reported key="rm" value={view.model.requestedModel} />],
    ["confirmedModel", <Reported key="cm" value={view.model.confirmedModel} />],
    [
      "requestedReasoning",
      <Reported key="rr" value={view.model.requestedReasoning} />,
    ],
    [
      "confirmedReasoning",
      <Reported key="cr" value={view.model.confirmedReasoning} />,
    ],
    [
      "sessionId",
      record.sessionId ? <LongValue value={record.sessionId} /> : unknown,
    ],
    ["lastActivity", lastActivity ?? unknown],
  ];
  return (
    <section aria-labelledby="console-metadata">
      <h3 id="console-metadata" className="mb-2 text-sm font-semibold">
        {t("plans.console.metadata")}
      </h3>
      <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([name, content]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">
              {t(`plans.console.field.${name}`)}
            </dt>
            <dd className="min-w-0">{content}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
