import { describe, expect, it, vi } from "vitest";

import { PAGES_CORE_CONTRACT_VERSION } from "@/definition/PagesCoreContract";

import { LiveChangeDecisions } from "./LiveChangeDecisions";

import type { LiveSession } from "./LiveChangeDecisions";
import type { PagesCoreLiveRequest } from "@/definition/PagesCoreContract";
import type { User } from "@/definition/User";

function userOf(mustChangePassword = false): User {
  return { id: "u", mustChangePassword } as unknown as User;
}

function build(sessions: Record<string, LiveSession | null>): {
  decisions: LiveChangeDecisions;
} {
  const notice = vi.fn((...call: [User, { id: string }]) =>
    Promise.resolve(
      call[1].id === "hidden"
        ? null
        : { kind: "ticket" as const, id: call[1].id },
    ),
  );
  const decisions = new LiveChangeDecisions({
    audience: { notice },
    readSession: (cookie) => Promise.resolve(sessions[cookie] ?? null),
    authorizationVersion: () => Promise.resolve("v1"),
  });
  return { decisions };
}

function requestOf(
  cookies: readonly string[],
  events: PagesCoreLiveRequest["events"],
): PagesCoreLiveRequest {
  return {
    contract: PAGES_CORE_CONTRACT_VERSION,
    sessions: cookies.map((cookie) => ({ key: `k-${cookie}`, cookie })),
    events,
  };
}

describe("LiveChangeDecisions", () => {
  it("ends sessions that are gone or must change the password", async () => {
    const { decisions } = build({ pw: { user: userOf(true), binding: "b" } });
    const answer = await decisions.decide(requestOf(["none", "pw"], []));
    expect(answer.sessions).toEqual([
      { key: "k-none", status: "ended" },
      { key: "k-pw", status: "ended" },
    ]);
  });

  it("decides each known event and skips unknown kinds", async () => {
    const { decisions } = build({ a: { user: userOf(), binding: "b" } });
    const audience = { projectId: "p", departmentIds: [] };
    const answer = await decisions.decide(
      requestOf(
        ["a"],
        [
          { position: 1, kind: "ticket.updated", id: "t", audience: null },
          { position: 2, kind: "ticket.updated", id: "hidden", audience: null },
          { position: 3, kind: "wiki.page.purged", id: "w", audience: null },
          { position: 4, kind: "other.kind", id: "x", audience: null },
          { position: 5, kind: "ticket.deleted", id: "d", audience },
        ],
      ),
    );
    expect(answer.sessions).toEqual([
      {
        key: "k-a",
        status: "active",
        version: "v1",
        binding: "b",
        decisions: [
          {
            position: 1,
            notice: "change",
            change: { kind: "ticket", id: "t" },
          },
          { position: 3, notice: "resync" },
          {
            position: 5,
            notice: "change",
            change: { kind: "ticket", id: "d" },
          },
        ],
      },
    ]);
  });

  it("handles more sessions than one parallel group", async () => {
    const cookies = Array.from({ length: 10 }, (_, index) => `c${index}`);
    const sessions = Object.fromEntries(
      cookies.map((cookie) => [cookie, { user: userOf(), binding: cookie }]),
    );
    const { decisions } = build(sessions);
    const answer = await decisions.decide(requestOf(cookies, []));
    expect(answer.contract).toBe(PAGES_CORE_CONTRACT_VERSION);
    expect(answer.sessions.map((session) => session.key)).toEqual(
      cookies.map((cookie) => `k-${cookie}`),
    );
  });
});
