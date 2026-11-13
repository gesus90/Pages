import { describe, expect, it } from "vitest";

import { parameterUses } from "@/backend/database/postgres/PostgresParameterUse";

describe("PostgreSQL parameter use", () => {
  it.each([
    [
      "SELECT $key FROM items WHERE name = $name",
      { key: "compared", name: "compared" },
    ],
    ["DELETE FROM items WHERE id = $id", { id: "compared" }],
    [
      "WITH x AS (DELETE FROM items WHERE id = $id) SELECT $other",
      { id: "unclear", other: "unclear" },
    ],
    [
      "UPDATE items SET name = $name, title = COALESCE($title, title) WHERE id = $id RETURNING $result",
      { name: "written", title: "written", id: "compared", result: "unclear" },
    ],
    [
      "UPDATE items SET name = upper($name) WHERE id = $name",
      { name: "unclear" },
    ],
    [
      "INSERT INTO items (id, name) VALUES ($id, $name), ($second, upper($other))",
      { id: "written", name: "written", second: "written", other: "unclear" },
    ],
    [
      "INSERT INTO items (id, name) SELECT $id, $name FROM source WHERE id = $source",
      { id: "written", name: "written", source: "compared" },
    ],
    [
      "INSERT INTO items (id) SELECT $id UNION SELECT $other",
      { id: "unclear", other: "unclear" },
    ],
    [
      "INSERT INTO items (id, name) VALUES ($id, $name) ON CONFLICT (id) DO UPDATE SET name = $updated WHERE items.id = $filter",
      {
        id: "unclear",
        name: "written",
        updated: "written",
        filter: "compared",
      },
    ],
    [
      "INSERT INTO items (id, name) VALUES ($id, $name) ON CONFLICT DO NOTHING",
      { id: "unclear", name: "unclear" },
    ],
    [
      "INSERT INTO items (id) DEFAULT VALUES RETURNING $result",
      { result: "unclear" },
    ],
    [
      "SELECT '$ignored', \"$identifier\" /* $comment */ -- $line\n WHERE id = $id;",
      { id: "compared" },
    ],
  ])("classifies placeholders in %s", (statement, expected) => {
    expect(Object.fromEntries(parameterUses(statement))).toEqual(expected);
  });
});
