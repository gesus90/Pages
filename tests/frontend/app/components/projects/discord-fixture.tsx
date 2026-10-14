import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { DiscordPanel } from "@/app/components/projects/discord-integration-panel";
import { createI18n } from "@/app/lib/i18n";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import type { RenderResult } from "@testing-library/react";
import type {
  DiscordActionResult,
  DiscordAttempt,
  DiscordChannelChoice,
  DiscordConnection,
  DiscordInterfaceState,
} from "@/definition/Discord";

/** The install link of the synthetic attempt. */
export const AUTHORIZE_URL =
  "https://discord.com/oauth2/authorize?client_id=1&scope=bot&permissions=3072&response_type=code&state=synthetic-state";

/** The state of a configured instance for a project manager, with nothing connected. */
export function managerState(
  overrides: Partial<DiscordInterfaceState> = {},
): DiscordInterfaceState {
  return {
    attempt: null,
    canManage: true,
    channels: null,
    channelsProblem: null,
    connection: null,
    instance: { isConfigured: true, missingSettings: [] },
    ...overrides,
  };
}

/** A connection of the project with the default event selection. */
export function connection(
  overrides: Partial<DiscordConnection> = {},
): DiscordConnection {
  return {
    channelId: "201",
    channelName: "general",
    connectedAt: "2026-10-15T10:00:00.000Z",
    delivery: {
      failed: 0,
      lastProblem: null,
      lastSentAt: null,
      pending: 0,
    },
    events: DEFAULT_DISCORD_EVENTS,
    guildId: "300",
    guildName: "Team server",
    projectId: "alpha",
    updatedAt: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

/** A connection attempt. */
export function attempt(
  overrides: Partial<DiscordAttempt> = {},
): DiscordAttempt {
  return {
    authorizeUrl: null,
    expiresAt: "2026-10-15T10:15:00.000Z",
    failure: null,
    guild: null,
    id: "attempt-1",
    status: "pending",
    ...overrides,
  };
}

/** A channel of the synthetic server. */
export function channel(
  id: string,
  name: string,
  overrides: Partial<DiscordChannelChoice> = {},
): DiscordChannelChoice {
  return {
    id,
    isSelectable: true,
    kind: "text",
    missing: [],
    name,
    ...overrides,
  };
}

/** The answer of the server to one request. */
export function success(
  state: DiscordInterfaceState,
  test: DiscordActionResult extends infer Result
    ? Result extends { ok: true; test: infer Test }
      ? Test
      : never
    : never = null,
): DiscordActionResult {
  return { ok: true, state, test };
}

/** A request the synthetic server received. */
export interface ReceivedCall {
  readonly method: string;
  readonly address: string;
  readonly form: Record<string, string>;
}

/**
 * Replaces `fetch` by a server that answers the scripted results in order.
 *
 * @remarks
 * A function answers later: the request stays open until the function's
 * promise settles, as a slow server does.
 * @returns The calls received so far, in order.
 */
export function scriptServer(
  results: readonly (
    DiscordActionResult | "network-error" | (() => Promise<DiscordActionResult>)
  )[],
): ReceivedCall[] {
  const calls: ReceivedCall[] = [];
  let next = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;

      calls.push({
        address: String(input),
        form:
          body instanceof URLSearchParams
            ? Object.fromEntries(body.entries())
            : {},
        method: init?.method ?? "GET",
      });

      // The last scripted answer repeats, as a server keeps answering.
      const result = results[Math.min(next, results.length - 1)];

      next += 1;

      if (result === "network-error" || result === undefined) {
        throw new TypeError("network down");
      }

      const answer = typeof result === "function" ? await result() : result;

      return Response.json(answer, { status: answer.ok ? 200 : 400 });
    }),
  );

  return calls;
}

/** Renders the Discord panel of the project "alpha". */
export function renderPanel(
  onConnectionChange: (isConnected: boolean) => void = () => undefined,
): RenderResult {
  return render(
    <I18nextProvider i18n={createI18n("en")}>
      <DiscordPanel
        onClose={() => undefined}
        onConnectionChange={onConnectionChange}
        projectId="alpha"
      />
    </I18nextProvider>,
  );
}
