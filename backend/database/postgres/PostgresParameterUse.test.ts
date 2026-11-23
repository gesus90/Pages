import { expect, it } from "vitest";

import { parameterUses } from "@/backend/database/postgres/PostgresParameterUse";

const uses = (statement: string): Record<string, string> =>
  Object.fromEntries(parameterUses(statement));

it("treats reads and deletes as comparisons", () => {
  expect(uses("SELECT a FROM t WHERE a = $a")).toEqual({ a: "compared" });
  expect(uses("WITH x AS (SELECT 1) SELECT $b")).toEqual({ b: "compared" });
  expect(uses("DELETE FROM t WHERE a = $a;")).toEqual({ a: "compared" });
});

it("treats a write inside a read as unclear", () => {
  expect(uses("WITH x AS (DELETE FROM t RETURNING a) SELECT $a")).toEqual({
    a: "unclear",
  });
  expect(uses("CALL f($a)")).toEqual({ a: "unclear" });
  expect(uses("")).toEqual({});
});

it("separates written and compared values in an UPDATE", () => {
  expect(
    uses(
      "UPDATE t SET a = $a, b = COALESCE($b, b), c = $c + 1, d = COALESCE($d, e), f = COALESCE($f, f, 1) WHERE id = $id RETURNING $r",
    ),
  ).toEqual({
    a: "written",
    b: "written",
    c: "unclear",
    d: "unclear",
    f: "unclear",
    id: "compared",
    r: "unclear",
  });
  expect(uses("UPDATE t SET a = $a WHERE (x = $a)")).toEqual({ a: "unclear" });
  expect(uses("UPDATE t SET a = $a FROM u WHERE u.x = $x")).toEqual({
    a: "written",
    x: "compared",
  });
  expect(
    uses("UPDATE t SET a = 1, b = (SELECT 1, 2) -- note\n /* c */"),
  ).toEqual({});
});

it("treats plain INSERT values as written", () => {
  expect(
    uses(
      'INSERT INTO t ("A", b) VALUES ($a, lower($b)), ($c, $d) RETURNING $r',
    ),
  ).toEqual({
    a: "written",
    b: "unclear",
    c: "written",
    d: "written",
    r: "unclear",
  });
  expect(uses("INSERT INTO t (a, b) VALUES ($a, $b, $c)")).toEqual({
    a: "written",
    b: "written",
    c: "unclear",
  });
});

it("handles INSERT ... SELECT", () => {
  expect(
    uses("INSERT INTO t (a, b) SELECT $a, $b FROM u WHERE u.x = $x"),
  ).toEqual({ a: "written", b: "written", x: "compared" });
  expect(uses("INSERT INTO t (a) SELECT $a UNION SELECT $b")).toEqual({
    a: "unclear",
    b: "unclear",
  });
});

it("handles other INSERT forms", () => {
  expect(uses("INSERT INTO t (a) DEFAULT VALUES")).toEqual({});
  expect(uses("INSERT INTO t SELECT $a")).toEqual({ a: "unclear" });
  expect(uses("INSERT INTO t")).toEqual({});
});

it("marks conflict keys as unclear", () => {
  expect(
    uses(
      "INSERT INTO t (id, a) VALUES ($id, $a) ON CONFLICT (id) DO UPDATE SET a = $a, b = $b WHERE t.x = $x RETURNING $r",
    ),
  ).toEqual({
    id: "unclear",
    a: "written",
    b: "written",
    x: "compared",
    r: "unclear",
  });
  expect(
    uses("INSERT INTO t (id, a) VALUES ($id, $a) ON CONFLICT DO NOTHING"),
  ).toEqual({ id: "unclear", a: "unclear" });
  expect(
    uses("INSERT INTO t (id, a) VALUES ($id, $a) ON CONFLICT (id) DO NOTHING"),
  ).toEqual({ id: "unclear", a: "written" });
});

it("treats every other trailing part of an INSERT as unclear", () => {
  expect(uses("INSERT INTO t (a) VALUES ($a) RETURNING $r")).toEqual({
    a: "written",
    r: "unclear",
  });
});
