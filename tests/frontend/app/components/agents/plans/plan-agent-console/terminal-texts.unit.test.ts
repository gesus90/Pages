import { expect, it } from "vitest";

import {
  failureText,
  terminalTexts,
} from "@/app/components/agents/plans/plan-agent-console/terminal-texts";
import { createI18n } from "@/app/lib/i18n";

const { t } = createI18n("en");
const texts = terminalTexts(t);
const key = "plans.console.terminal";

it("translates the fixed words of the terminal", () => {
  expect(texts.done).toBe(t(`${key}.done`));
  expect(texts.aborted).toBe(t(`${key}.aborted`));
  expect(texts.turnEnded).toBe(t(`${key}.turnEnded`));
  expect(texts.interrupted).toBe(t(`${key}.interrupted`));
  expect(texts.sessionClosed).toBe(t(`${key}.sessionClosed`));
  expect(texts.noReport).toBe(t(`${key}.noReport`));
  expect(texts.stopped).toBe(t(`${key}.stopped`));
  for (const word of [
    texts.done,
    texts.aborted,
    texts.turnEnded,
    texts.interrupted,
    texts.sessionClosed,
    texts.noReport,
    texts.stopped,
  ])
    expect(word).not.toBe("");
});

it("fills attempt, todo and report words with their values", () => {
  expect(texts.attempt(3)).toBe(t(`${key}.attempt`, { number: 3 }));
  expect(texts.attempt(3)).toContain("3");
  expect(texts.todoActive("T1", "Read it")).toBe(
    t(`${key}.todoActive`, { id: "T1", text: "Read it" }),
  );
  expect(texts.todoActive("T1", "Read it")).toContain("Read it");
  expect(texts.todoDone("T2")).toContain("T2");
  expect(texts.reportReceived(2, 5)).toBe(
    t(`${key}.reportReceived`, { done: 2, total: 5 }),
  );
});

it("names the tool kinds the terminal knows and leaves other kinds to the title", () => {
  for (const kind of [
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "fetch",
  ])
    expect(texts.toolKind(kind)).toBe(t(`${key}.toolKind.${kind}`));
  expect(texts.toolKind("other")).toBeNull();
  expect(texts.toolKind("think")).toBeNull();
});

it("tells resume and repair with the wording of the same or a new session", () => {
  const sameResume = texts.resume(60, 2, 3, true);
  const newResume = texts.resume(60, 2, 3, false);
  expect(sameResume).toContain(t(`${key}.sameSession`));
  expect(newResume).toContain(t(`${key}.newSession`));
  expect(sameResume).not.toBe(newResume);
  expect(sameResume).toContain("60");
  const sameRepair = texts.repair(1, 2, true);
  const newRepair = texts.repair(1, 2, false);
  expect(sameRepair).toContain(t(`${key}.sameSession`));
  expect(newRepair).toContain(t(`${key}.newSession`));
});

it("explains the reason of an abort and of a block by the error text, and keeps an unknown code as it is", () => {
  expect(texts.abort("zz_unknown_code")).toContain("zz_unknown_code");
  expect(texts.blocked("zz_unknown_code", 4)).toContain("zz_unknown_code");
  expect(texts.blocked("zz_unknown_code", 4)).toContain("4");
  expect(failureText(t, "zz_unknown_code")).toBe("zz_unknown_code");
  const known = "The Codex ACP session failed before or during its turn.";
  expect(failureText(t, "plan_acp_session_failed")).toBe(known);
  expect(texts.abort("plan_acp_session_failed")).toContain(known);
  expect(texts.blocked("plan_acp_session_failed", 2)).toContain(known);
});
