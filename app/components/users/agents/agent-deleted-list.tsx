import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { backendRequestHeaders } from "@/app/lib/backend-request";
import {
  useUsersActionData,
  useIsSubmitting,
} from "@/app/components/users/use-users-action";

import type { DeletedAgent } from "@/definition/AgentDeletion";

function isDeletedList(
  input: unknown,
): input is { readonly agents: readonly DeletedAgent[] } {
  return (
    typeof input === "object" &&
    input !== null &&
    "agents" in input &&
    Array.isArray(input.agents)
  );
}

function remainingTime(
  until: string,
  currentTime: number,
): {
  readonly days: number;
  readonly hours: number;
} {
  const totalHours = Math.max(
    0,
    Math.ceil((Date.parse(until) - currentTime) / 3_600_000),
  );
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
}

/** Recently deleted agents, visible only in the administrator's management view. */
export function AgentDeletedList(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const submit = useSubmit();
  const result = useUsersActionData();
  const isSubmitting = useIsSubmitting("restore-agent");
  const [agents, setAgents] = useState<readonly DeletedAgent[]>([]);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  useEffect(() => {
    setCurrentTime(Date.now());
    const interval = window.setInterval(
      () => setCurrentTime(Date.now()),
      60_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/users-api/agents/deleted", {
      headers: backendRequestHeaders({ Accept: "application/json" }),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const answer: unknown = await response.json();
        if (
          !controller.signal.aborted &&
          response.ok &&
          isDeletedList(answer)
        ) {
          setAgents(answer.agents);
          setFailed(false);
        } else if (!controller.signal.aborted) setFailed(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] Deleted agents could not be listed.", error);
        setFailed(true);
      });
    return () => controller.abort();
  }, [result]);

  function restore(agentId: string): void {
    const formData = new FormData();
    formData.set("intent", "restore-agent");
    formData.set("agentId", agentId);
    formData.set("operationId", crypto.randomUUID());
    void submit(formData, { method: "post" });
  }

  return (
    <section className="mt-8 border-t border-border pt-5">
      <h2 className="text-lg font-semibold text-foreground">
        {t("agentEmployees.deletion.deletedTitle")}
      </h2>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("agentEmployees.deletion.loadFailed")}
        </p>
      ) : null}
      {agents.length === 0 && !failed ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("agentEmployees.deletion.noDeleted")}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {agents.map((agent) => (
          <li
            key={agent.agentId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <div>
              <p className="font-medium text-foreground">{agent.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {t("agentEmployees.deletion.restorableUntil", {
                  date: new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(agent.restorableUntil)),
                })}
              </p>
              {currentTime !== null ? (
                <p className="text-xs text-muted-foreground">
                  {t("agentEmployees.deletion.remaining", {
                    ...remainingTime(agent.restorableUntil, currentTime),
                  })}
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => restore(agent.agentId)}
            >
              {t("agentEmployees.deletion.restore")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
