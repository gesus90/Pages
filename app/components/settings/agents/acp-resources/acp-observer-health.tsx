import { useTranslation } from "react-i18next";

import { observerFailureText } from "@/app/lib/observer-failure-text";

import { AgentCheckTime } from "../agent-check-time";

import type { ConversationObserverHealth } from "@/definition/ConversationObserver";

/**
 * How the group observer fared in the last 24 hours (PAGE-340), so a series
 * of failed observer calls is visible with its cause.
 */
export function AcpObserverHealth({
  observer,
}: {
  readonly observer: ConversationObserverHealth | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!observer) return null;
  const calls = observer.succeeded + observer.failed + observer.refused;
  const isFailing =
    observer.lastFailure !== null && observer.failed + observer.refused > 0;
  return (
    <section
      aria-label={t("settings.agents.resources.observer.title")}
      className="space-y-1 rounded-md border border-border p-3"
    >
      <p className="font-medium">
        {t("settings.agents.resources.observer.title")}
      </p>
      <p className="text-muted-foreground">
        {calls === 0
          ? t("settings.agents.resources.observer.none")
          : t("settings.agents.resources.observer.summary", {
              succeeded: observer.succeeded,
              failed: observer.failed,
              refused: observer.refused,
            })}
      </p>
      {observer.lastSuccessAt ? (
        <p className="text-muted-foreground">
          {t("settings.agents.resources.observer.lastSuccess")}{" "}
          <AgentCheckTime checkedAt={observer.lastSuccessAt} />
        </p>
      ) : null}
      {isFailing && observer.lastFailure ? (
        <div role="alert" className="space-y-1 text-destructive">
          <p>
            {t(
              `settings.agents.resources.observer.lastFailure.${observer.lastFailure.kind}`,
            )}{" "}
            <AgentCheckTime checkedAt={observer.lastFailure.at} />
          </p>
          <p>{observerFailureText(t, observer.lastFailure)}</p>
          <p className="text-xs">
            {t("settings.agents.resources.observer.reservations")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
