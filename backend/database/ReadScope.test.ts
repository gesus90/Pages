import { expect, it } from "vitest";

import {
  ReadScope,
  currentReadScope,
  readScopeKey,
  statementKind,
  withReadScope,
  withoutReadScope,
} from "@/backend/database/ReadScope";

it("sorts statements by what they do", () => {
  expect(statementKind("SELECT 1")).toBe("repeatable");
  expect(statementKind("WITH x AS (SELECT 1) SELECT a FROM x")).toBe(
    "repeatable",
  );
  expect(statementKind("UPDATE t SET a = 1")).toBe("write");
  expect(statementKind("SELECT nextval('s')")).toBe("write");
  expect(statementKind("SELECT now()")).toBe("volatile");
  expect(statementKind("SELECT 1")).toBe("repeatable");
});

it("stops remembering statement kinds after the limit", () => {
  for (let index = 0; index < 2100; index += 1)
    statementKind(`SELECT ${String(index)}`);
  expect(statementKind("SELECT 99999")).toBe("repeatable");
});

it("names a statement with its values", () => {
  expect(readScopeKey("S", { b: 2, a: "x" })).toBe(
    readScopeKey("S", { a: "x", b: 2 }),
  );
  expect(readScopeKey("S", { a: 1 })).not.toBe(readScopeKey("S", { a: "1" }));
  expect(readScopeKey("S", { a: Buffer.from("x") })).toBeNull();
});

it("remembers rows only while the epoch is unchanged", () => {
  const scope = new ReadScope();
  expect(scope.find("k", 0)).toBeNull();
  scope.store("k", 0, [["a", 1, null]]);
  const found = scope.find("k", 0);
  expect(found).toEqual([["a", 1, null]]);
  found?.push(["mutated"]);
  expect(scope.find("k", 0)).toEqual([["a", 1, null]]);
  expect(scope.find("k", 1)).toBeNull();
  expect(scope.find("k", 0)).toBeNull();
});

it("replaces an earlier answer of the same key", () => {
  const scope = new ReadScope();
  scope.store("k", 0, [["a"]]);
  scope.store("k", 1, [["b"]]);
  expect(scope.find("k", 1)).toEqual([["b"]]);
});

it("does not keep large values", () => {
  const scope = new ReadScope();
  scope.store("text", 0, [["x".repeat(16_385)]]);
  scope.store("blob", 0, [[Buffer.from("x")]]);
  expect(scope.find("text", 0)).toBeNull();
  expect(scope.find("blob", 0)).toBeNull();
});

it("bounds the number of entries and the total size", () => {
  const scope = new ReadScope();
  for (let index = 0; index < 4096; index += 1)
    scope.store(`k${String(index)}`, 0, [[1]]);
  scope.store("extra", 0, [[1]]);
  expect(scope.find("extra", 0)).toBeNull();
  expect(scope.find("k0", 0)).toEqual([[1]]);
  const large = new ReadScope();
  const chunk = "y".repeat(16_000);
  for (let index = 0; index < 251; index += 1)
    large.store(`c${String(index)}`, 0, [[chunk]]);
  expect(large.find("c249", 0)).not.toBeNull();
  expect(large.find("c250", 0)).toBeNull();
});

it("shares one scope in a unit of work and joins an open one", async () => {
  expect(currentReadScope()).toBeUndefined();
  await withReadScope(async () => {
    const outer = currentReadScope();
    expect(outer).toBeInstanceOf(ReadScope);
    await withReadScope(() => {
      expect(currentReadScope()).toBe(outer);
      return Promise.resolve();
    });
    await withoutReadScope(() => {
      expect(currentReadScope()).toBeUndefined();
      return Promise.resolve();
    });
  });
});
