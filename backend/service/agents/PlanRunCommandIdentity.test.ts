import { randomUUID } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import {
  completePlanRunCommand,
  planRunCommandKey,
} from "@/app/components/agents/plans/plan-run-command-key";

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, content: string) => stored.set(key, content),
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

it("reuses an unanswered command across duplicate clicks and a module reload", async () => {
  const identity = randomUUID();
  const key = planRunCommandKey(identity);
  expect(planRunCommandKey(identity)).toBe(key);
  vi.resetModules();
  const reloaded =
    await import("@/app/components/agents/plans/plan-run-command-key");
  expect(reloaded.planRunCommandKey(identity)).toBe(key);
  reloaded.completePlanRunCommand(key);
  expect(reloaded.planRunCommandKey(identity)).not.toBe(key);
});

it("does not complete a different pending command", () => {
  const identity = randomUUID();
  const key = planRunCommandKey(identity);
  completePlanRunCommand("unrelated-response");
  expect(planRunCommandKey(identity)).toBe(key);
  completePlanRunCommand(key);
  expect(planRunCommandKey(identity)).not.toBe(key);
});

it("retains in-memory retry identity when browser storage is unavailable", () => {
  vi.stubGlobal("window", {
    get sessionStorage(): never {
      throw new Error("Storage unavailable");
    },
  });
  const identity = randomUUID();
  const key = planRunCommandKey(identity);
  expect(planRunCommandKey(identity)).toBe(key);
  completePlanRunCommand(key);
  expect(planRunCommandKey(identity)).not.toBe(key);
});
