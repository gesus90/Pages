import { expect, it } from "vitest";

import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";

const SQL =
  POSTGRES_MIGRATIONS.find(
    (migration) => migration.name === "060_group_decision_rules.sql",
  )?.sql ?? "";

it("takes over the groups as the ticket says: observer and decision become \"@ + Decision\", mentions stays", () => {
  expect(SQL).toContain(
    "UPDATE conversation_reply_settings\nSET mode = 'decision'\nWHERE mode IN ('observer', 'decision');",
  );
  expect(SQL).toContain("CHECK (mode IN ('mentions', 'decision'))");
  expect(SQL).toContain("ALTER COLUMN mode SET DEFAULT 'decision'");
  expect(SQL).not.toMatch(/SET mode = 'mentions'/u);
});

it("clears the chat model of the earlier decision setting, because only a decision model fits", () => {
  expect(SQL).toMatch(
    /UPDATE chat_decision_settings\s+SET connection_id = NULL,\s+model = NULL/u,
  );
  expect(SQL).toContain("answer_threshold INTEGER NOT NULL DEFAULT 60");
  expect(SQL).toContain("responsibility_threshold INTEGER NOT NULL DEFAULT 50");
  expect(SQL).toContain("second_threshold INTEGER NOT NULL DEFAULT 40");
  expect(SQL).toContain("max_responders INTEGER NOT NULL DEFAULT 2");
});

it("drops the old outcome checks before it rewrites the values they forbid", () => {
  const dropped = SQL.indexOf(
    "DROP CONSTRAINT conversation_reply_decisions_outcome_check",
  );
  const rewritten = SQL.indexOf("SET outcome = 'unavailable'");
  expect(dropped).toBeGreaterThan(-1);
  expect(rewritten).toBeGreaterThan(dropped);
});
