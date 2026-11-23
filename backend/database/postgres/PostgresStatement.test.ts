import { expect, it } from "vitest";

import { bindStatement } from "@/backend/database/postgres/PostgresStatement";

it("numbers named placeholders in order of first use", () => {
  const bound = bindStatement(
    "SELECT a FROM t WHERE a = $a AND b = $b AND c = $a",
    { a: 1, b: "x" },
  );
  expect(bound.text).toBe("SELECT a FROM t WHERE a = $1 AND b = $2 AND c = $1");
  expect(bound.values).toEqual([1, "x"]);
  expect(bound.removedNulCharacters).toBe(0);
});

it("leaves dollar signs in literals, identifiers, comments and quoted text", () => {
  const statement = `SELECT 'a $x', E'it\\'s $x', "$x", $tag$ $x $tag$, $$ $x $$ -- $x\n/* $x */ FROM t WHERE a = $a AND b$c = 1`;
  const bound = bindStatement(statement, { a: 1 });
  expect(bound.text).toBe(statement.replace("= $a", "= $1"));
});

it("maps booleans and null", () => {
  const bound = bindStatement("SELECT $a, $b, $c, $d", {
    a: true,
    b: false,
    c: null,
    d: 2n,
  });
  expect(bound.values).toEqual([1, 0, null, 2n]);
});

it("refuses unknown and missing parameters by name", () => {
  expect(() => bindStatement("SELECT $a", { a: 1, b: 2 })).toThrow('"b"');
  expect(() => bindStatement("SELECT $a", {})).toThrow('"a"');
  const unset = { a: undefined };
  expect(() => bindStatement("SELECT $a", unset as never)).toThrow('"a"');
});

it("removes U+0000 from written text and counts it", () => {
  const bound = bindStatement("UPDATE t SET a = $a", { a: "x\u0000y" });
  expect(bound.values).toEqual(["xy"]);
  expect(bound.removedNulCharacters).toBe(1);
  const kept = bindStatement("INSERT INTO t (a) VALUES ($a)", {
    a: "\\\u0000u0000",
  });
  expect(kept.values).toEqual(["\\\u0000u0000"]);
  expect(kept.removedNulCharacters).toBe(0);
});

it("replaces compared text with a stand-in and passes unclear text on", () => {
  const compared = bindStatement("SELECT 1 WHERE a = $a", { a: "x\u0000" });
  const standIn = compared.values[0];
  expect(standIn).toMatch(/^no-stored-text-/u);
  expect(compared.comparisonStandIns).toEqual([standIn]);
  const unclear = bindStatement("CALL f($a)", { a: "x\u0000" });
  expect(unclear.values).toEqual(["x\u0000"]);
  expect(unclear.comparisonStandIns).toEqual([]);
  const plain = bindStatement("CALL f($a)", { a: "x" });
  expect(plain.values).toEqual(["x"]);
});

it("reuses a translation", () => {
  const first = bindStatement("SELECT $z", { z: 1 });
  expect(bindStatement("SELECT $z", { z: 2 }).text).toBe(first.text);
});

it("stops caching after the limit", () => {
  for (let index = 0; index < 2100; index += 1)
    bindStatement(`SELECT ${String(index)} WHERE a = $a`, { a: 1 });
  expect(bindStatement("SELECT 1 WHERE a = $a", { a: 1 }).values).toEqual([1]);
});
