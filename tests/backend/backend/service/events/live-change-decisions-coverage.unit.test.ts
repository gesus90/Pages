import { expect, it, vi } from "vitest";

import { LiveChangeDecisions } from "@/backend/service/events/LiveChangeDecisions";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { LiveChangeDecisionDependencies } from "@/backend/service/events/LiveChangeDecisions";
import type { User } from "@/definition/User";

it("ends invalid sessions and discloses only visible changes to active sessions", async () => {
  const user = partial<User>({ id: "user", mustChangePassword: false });
  const notice = vi.fn<LiveChangeDecisionDependencies["audience"]["notice"]>(
    async (actor, event) =>
      actor === user && event.id === "visible"
        ? { kind: "ticket", id: event.id }
        : null,
  );
  const decisions = new LiveChangeDecisions({
    readSession: async (cookie) =>
      cookie === "valid" ? { user, binding: "binding" } : null,
    authorizationVersion: async () => "version",
    audience: { notice },
  });
  const result = await decisions.decide({
    contract: 1,
    sessions: [
      { key: "active", cookie: "valid" },
      { key: "ended", cookie: "missing" },
    ],
    events: [
      { position: 1, kind: "ticket.changed", id: "visible", audience: null },
      { position: 2, kind: "ticket.changed", id: "hidden", audience: null },
      {
        position: 3,
        kind: "project.access.changed",
        id: "project",
        audience: null,
      },
      { position: 4, kind: "unknown.event", id: "unknown", audience: null },
    ],
  });
  expect(result.sessions).toEqual([
    {
      key: "active",
      status: "active",
      version: "version",
      binding: "binding",
      decisions: [
        {
          position: 1,
          notice: "change",
          change: { kind: "ticket", id: "visible" },
        },
        { position: 3, notice: "resync" },
      ],
    },
    { key: "ended", status: "ended" },
  ]);
  expect(notice).toHaveBeenCalledTimes(2);
});

it("ends a session that must change its password before reading rights", async () => {
  const authorizationVersion = vi.fn(async () => "version");
  const decisions = new LiveChangeDecisions({
    readSession: async () => ({
      user: partial<User>({ mustChangePassword: true }),
      binding: "binding",
    }),
    authorizationVersion,
    audience: { notice: vi.fn() },
  });
  await expect(
    decisions.decide({
      contract: 1,
      sessions: [{ key: "session", cookie: "cookie" }],
      events: [],
    }),
  ).resolves.toMatchObject({ sessions: [{ key: "session", status: "ended" }] });
  expect(authorizationVersion).not.toHaveBeenCalled();
});
