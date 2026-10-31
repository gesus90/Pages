import { describe, expect, it } from "vitest";

import {
  ReadScope,
  currentReadScope,
  readScopeKey,
  statementKind,
  withReadScope,
} from "@/backend/database/ReadScope";

describe("sorting a statement", () => {
  it.each([
    "SELECT id FROM projects WHERE id = $id;",
    "  select id from projects;",
    "WITH recent AS (SELECT id FROM projects) SELECT id FROM recent;",
    "SELECT json_extract_string(plan_json, '$.sharing') AS sharing FROM agent_plans;",
  ])("treats %s as a read that repeats its answer", (statement) => {
    expect(statementKind(statement)).toBe("repeatable");
  });

  it.each([
    "INSERT INTO projects (id) VALUES ($id);",
    "UPDATE projects SET name = $name;",
    "DELETE FROM projects;",
    "CREATE TABLE t (id TEXT);",
    "BEGIN TRANSACTION;",
    "CHECKPOINT;",
    "SELECT 1; INSERT INTO t VALUES (1);",
    "SELECT nextval('ticket_numbers');",
    "WITH moved AS (DELETE FROM t RETURNING id) SELECT id FROM moved;",
    "INSERT INTO t VALUES (1) RETURNING id;",
  ])("treats %s as a write", (statement) => {
    expect(statementKind(statement)).toBe("write");
  });

  it.each([
    "SELECT utc_now();",
    "SELECT now();",
    "SELECT id FROM t WHERE created_at < current_timestamp;",
    "SELECT random();",
    "SELECT uuid();",
  ])("never repeats %s, because the answer changes by itself", (statement) => {
    expect(statementKind(statement)).toBe("volatile");
  });

  it("gives the same answer for a statement it has sorted before", () => {
    const statement = "SELECT id FROM sorted_twice;";

    expect(statementKind(statement)).toBe(statementKind(statement));
  });
});

describe("naming a read", () => {
  it("is the same for the same statement and values, whatever the order of the names", () => {
    expect(readScopeKey("SELECT 1;", { a: "x", b: 2 })).toBe(
      readScopeKey("SELECT 1;", { b: 2, a: "x" }),
    );
  });

  it("differs when a value, its type, its name or the statement differs", () => {
    const base = readScopeKey("SELECT 1;", { a: "1" });

    expect(readScopeKey("SELECT 1;", { a: "2" })).not.toBe(base);
    expect(readScopeKey("SELECT 1;", { a: 1 })).not.toBe(base);
    expect(readScopeKey("SELECT 1;", { b: "1" })).not.toBe(base);
    expect(readScopeKey("SELECT 2;", { a: "1" })).not.toBe(base);
  });

  it("gives up on a value it cannot tell apart cheaply", () => {
    expect(readScopeKey("SELECT 1;", { file: Buffer.from("x") })).toBeNull();
  });
});

describe("a scope that remembers reads", () => {
  it("hands out a copy while no write happened and forgets after one", () => {
    const scope = new ReadScope();

    scope.store("key", 3, [["a", 1]]);

    expect(scope.find("key", 3)).toEqual([["a", 1]]);
    expect(scope.find("key", 4)).toBeNull();
    expect(scope.find("key", 3)).toBeNull();
  });

  it("does not let a caller change what it remembers", () => {
    const scope = new ReadScope();
    const rows = [["a", 1]];

    scope.store("key", 1, rows);
    rows[0][0] = "changed before";
    const first = scope.find("key", 1);
    first?.push(["extra", 2]);
    if (first) first[0][1] = 99;

    expect(scope.find("key", 1)).toEqual([["a", 1]]);
  });

  it("keeps nothing for a value too large to hold on to", () => {
    const scope = new ReadScope();

    scope.store("large", 1, [["x".repeat(20_000)]]);
    scope.store("blob", 1, [[Buffer.from("x")]]);

    expect(scope.find("large", 1)).toBeNull();
    expect(scope.find("blob", 1)).toBeNull();
  });

  it("stops remembering once the total text is too much", () => {
    const scope = new ReadScope();
    const large = "x".repeat(16_000);

    for (let index = 0; index < 300; index += 1)
      scope.store(`key-${index}`, 1, [[large]]);

    expect(scope.find("key-0", 1)).not.toBeNull();
    expect(scope.find("key-299", 1)).toBeNull();
  });

  it("replaces an earlier answer of the same read", () => {
    const scope = new ReadScope();

    scope.store("key", 1, [["old"]]);
    scope.store("key", 2, [["new"]]);

    expect(scope.find("key", 2)).toEqual([["new"]]);
  });
});

describe("the scope of a unit of work", () => {
  it("exists only inside the unit of work", async () => {
    expect(currentReadScope()).toBeUndefined();

    const inside = await withReadScope(async () => currentReadScope());

    expect(inside).toBeInstanceOf(ReadScope);
    expect(currentReadScope()).toBeUndefined();
  });

  it("is shared with a unit of work started inside it, across awaits", async () => {
    await withReadScope(async () => {
      const outer = currentReadScope();

      await Promise.resolve();
      const nested = await withReadScope(async () => currentReadScope());

      expect(nested).toBe(outer);
    });
  });

  it("is never shared between two separate units of work", async () => {
    const [first, second] = await Promise.all([
      withReadScope(async () => currentReadScope()),
      withReadScope(async () => currentReadScope()),
    ]);

    expect(first).not.toBe(second);
  });

  it("returns what the work returns and rethrows its failure", async () => {
    await expect(withReadScope(async () => "done")).resolves.toBe("done");
    await expect(
      withReadScope(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
  });
});
