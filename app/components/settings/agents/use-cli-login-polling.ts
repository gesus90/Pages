import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import { isAgentErrorCode } from "@/backend/error/AgentErrors";
import { isLoginActive } from "@/definition/AgentConnection";

import type {
  AgentConnectionSummary,
  CliLoginView,
} from "@/definition/AgentConnection";

interface LoginPollResult {
  readonly login: CliLoginView | null;
  readonly hasError: boolean;
}

const LOGIN_STATES = [
  "starting",
  "awaiting_user",
  "verifying",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
];

function isLoginView(value: unknown): value is CliLoginView {
  if (!value || typeof value !== "object" || !("state" in value)) return false;
  if (typeof value.state !== "string" || !LOGIN_STATES.includes(value.state))
    return false;
  for (const key of ["verificationUrl", "userCode", "expiresAt"]) {
    if (key in value && typeof Reflect.get(value, key) !== "string")
      return false;
  }
  return !("errorCode" in value) || isAgentErrorCode(value.errorCode);
}

async function pollLogin(
  id: string,
  signal: AbortSignal,
): Promise<LoginPollResult> {
  try {
    const response = await fetch(
      `/settings-api/agents/${encodeURIComponent(id)}/login`,
      { cache: "no-store", signal },
    );
    if (!response.ok) return { login: null, hasError: true };
    const result: unknown = await response.json();
    if (result === null || isLoginView(result))
      return { login: result, hasError: false };
    return { login: null, hasError: true };
  } catch {
    return { login: null, hasError: true };
  }
}

/** Polls only active sessions, keeping short-lived challenges in component memory. */
export function useCliLoginPolling(
  connections: readonly AgentConnectionSummary[],
): Readonly<Record<string, LoginPollResult>> {
  const { revalidate } = useRevalidator();
  const [sessions, setSessions] = useState<
    Readonly<Record<string, LoginPollResult>>
  >({});
  const activeIds = connections
    .filter(
      (connection) =>
        connection.cli?.login && isLoginActive(connection.cli.login.state),
    )
    .map((connection) => connection.id)
    .join(",");
  useEffect(() => {
    setSessions({});
    if (!activeIds) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh(): Promise<void> {
      const entries = await Promise.all(
        activeIds
          .split(",")
          .map(
            async (id) => [id, await pollLogin(id, controller.signal)] as const,
          ),
      );
      if (controller.signal.aborted) return;
      setSessions(Object.fromEntries(entries));
      const hasEnded = entries.some(
        ([, result]) =>
          !result.hasError &&
          (!result.login || !isLoginActive(result.login.state)),
      );
      if (hasEnded) await revalidate();
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void refresh();
        }, 2000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeIds, revalidate]);
  return sessions;
}
