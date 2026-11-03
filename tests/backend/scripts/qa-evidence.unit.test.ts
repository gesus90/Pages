import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import backendConfig from "../../../vitest.backend.config";
import frontendConfig from "../../../vitest.frontend.config";

import {
  buildManifest,
  COVERAGE_POPULATIONS,
  currentManifest,
  evaluateCoverage,
  evaluateHandoff,
  handoffIssues,
  inspectDependencies,
  isInFingerprintScope,
  isSummaryStale,
  populationIssues,
} from "@/scripts/qa-evidence.mjs";

const COMPLETE = { covered: 4, total: 4, skipped: 0, pct: 100 };

function summary(counter: Record<string, number> = COMPLETE): {
  readonly total: Record<string, Record<string, number>>;
} & Record<string, Record<string, Record<string, number>>> {
  const metrics = {
    statements: counter,
    branches: counter,
    functions: counter,
    lines: counter,
  };
  return { total: metrics, "/repo/a.ts": metrics };
}

function withoutLines(): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(summary().total).filter(([metric]) => metric !== "lines"),
  );
}

it("accepts raw counters only when every metric of every file is complete", () => {
  expect(evaluateCoverage(summary())).toMatchObject({ gaps: [], issues: [] });
});

it("refuses a total that only rounds to 100 percent", () => {
  const nearly = { covered: 99_999, total: 100_000, skipped: 0, pct: 100 };

  const result = evaluateCoverage(summary(nearly));

  expect(result.issues).toEqual([
    "incomplete:statements",
    "incomplete:branches",
    "incomplete:functions",
    "incomplete:lines",
  ]);
  expect(result.gaps).toEqual([
    {
      file: "/repo/a.ts",
      uncovered: { statements: 1, branches: 1, functions: 1, lines: 1 },
    },
  ]);
});

it("refuses skipped code, a missing metric, an empty population and no summary", () => {
  expect(
    evaluateCoverage(summary({ ...COMPLETE, skipped: 1 })).issues,
  ).toContain("skipped:lines");
  expect(evaluateCoverage({ total: withoutLines() }).issues).toEqual([
    "metric_missing:lines",
  ]);
  expect(
    evaluateCoverage(summary({ covered: 0, total: 0, skipped: 0 })).issues,
  ).toContain("population_empty");
  expect(evaluateCoverage(null).issues).toEqual(["summary_invalid"]);
});

it("reports a file gap even when the total is complete", () => {
  const coverage = summary();
  coverage["/repo/a.ts"] = {
    ...coverage["/repo/a.ts"],
    branches: { covered: 3, total: 4, skipped: 0 },
  };

  expect(evaluateCoverage(coverage).gaps).toHaveLength(1);
});

it("keeps the same fingerprint for the same state in any order and changes it with any input", () => {
  const hash = (file: string): string | null =>
    file === "gone.ts" ? null : `hash-${file}`;
  const runtime = { node: "v24" };

  const first = buildManifest(["b.ts", "a.ts", "gone.ts"], hash, runtime);
  const second = buildManifest(
    ["gone.ts", "a.ts", "b.ts", "a.ts"],
    hash,
    runtime,
  );

  expect(second.fingerprint).toBe(first.fingerprint);
  expect(first.fileCount).toBe(3);
  expect(first.manifest).toContain("gone.ts\0DELETED");
  expect(buildManifest(["b.ts", "a.ts"], hash, runtime).fingerprint).not.toBe(
    first.fingerprint,
  );
  expect(
    buildManifest(["b.ts", "a.ts", "gone.ts"], (file) => `x${file}`, runtime)
      .fingerprint,
  ).not.toBe(first.fingerprint);
  expect(
    buildManifest(["b.ts", "a.ts", "gone.ts"], hash, { node: "v25" })
      .fingerprint,
  ).not.toBe(first.fingerprint);
});

it("leaves attached ticket assets out of the manifest", () => {
  const result = buildManifest(
    ["a.ts", "docs/.pages-assets-1.png"],
    () => "hash",
    {},
  );

  expect(result.fileCount).toBe(1);
});

it.each([
  ["backend/x.ts", "pages", true],
  ["mobile/x.ts", "pages", false],
  // Pages imports the tool catalog, so a change there is stale for both steps.
  ["mcp/src/tools/x.ts", "pages", true],
  ["mcp/package.json", "pages", true],
  ["mcp/tests/x.ts", "pages", false],
  ["mcp/src/tools/x.ts", "mcp", true],
  ["mcp/tests/x.ts", "mcp", true],
  ["backend/x.ts", "mcp", false],
])("decides whether %s belongs to the %s fingerprint", (file, scope, isIn) => {
  expect(isInFingerprintScope(file, scope)).toBe(isIn);
});

it("names why installed modules cannot serve a gate", () => {
  const state = { settings: { enableGlobalVirtualStore: false } };

  expect(
    inspectDependencies({ lockfile: "a", installedLockfile: "a", state }),
  ).toEqual([]);
  expect(
    inspectDependencies({ lockfile: "a", installedLockfile: "b", state }),
  ).toEqual(["lockfile_stale"]);
  expect(
    inspectDependencies({ lockfile: "a", installedLockfile: null, state }),
  ).toEqual(["modules_missing"]);
  expect(
    inspectDependencies({ lockfile: null, installedLockfile: "a", state }),
  ).toEqual(["lockfile_missing"]);
  // The layout of a CI install that a later run without CI would purge.
  expect(
    inspectDependencies({ lockfile: "a", installedLockfile: "a", state: {} }),
  ).toEqual(["modules_layout_stale"]);
});

it("refuses counters that are no integers and a file without a metric", () => {
  const broken = summary();
  expect(
    evaluateCoverage({
      total: { ...broken.total, lines: { covered: "4", total: 4 } },
    }).issues,
  ).toEqual(["metric_invalid:lines"]);
  expect(
    evaluateCoverage({ total: broken.total, "/repo/a.ts": withoutLines() })
      .gaps,
  ).toHaveLength(1);
});

it("calls a summary stale when a source file is newer", () => {
  expect(isSummaryStale(100, 200)).toBe(true);
  expect(isSummaryStale(200, 200)).toBe(false);
});

const CURRENT = "a".repeat(64);
const TOTALS = JSON.stringify(summary().total);
const GOOD_REPORT =
  '```pages-report\n{"todos":[{"id":"T1","status":"done"}],"criteria":[{"id":"K1","met":true,"evidence":"logs"}],"summary":"x"}\n```';

function handoff(changes: {
  readonly status?: string;
  readonly fingerprint?: string;
  readonly backend?: string;
  readonly report?: string;
}): string {
  return [
    `{"status":"${changes.status ?? "done"}","message":"x"}`,
    "",
    `pages-fingerprint: ${changes.fingerprint ?? CURRENT}`,
    `coverage-backend: ${changes.backend ?? TOTALS}`,
    `coverage-frontend: ${TOTALS}`,
    "",
    changes.report ?? GOOD_REPORT,
  ].join("\n");
}

it("releases Git only for a complete, current Pages report", () => {
  expect(evaluateHandoff(handoff({}), "pages", CURRENT)).toEqual([]);
});

it.each<[string, Parameters<typeof handoff>[0], string]>([
  ["a blocked status", { status: "blocked" }, "status:blocked"],
  ["an open status", { status: "open" }, "status:open"],
  ["a stale fingerprint", { fingerprint: "b".repeat(64) }, "fingerprint_stale"],
  ["no valid fingerprint", { fingerprint: "short" }, "fingerprint_missing"],
  [
    "counters one below their total",
    {
      backend: JSON.stringify(
        summary({ covered: 99_999, total: 100_000, skipped: 0, pct: 100 })
          .total,
      ),
    },
    "coverage_backend:incomplete:statements",
  ],
  ["unreadable counters", { backend: "100 %" }, "coverage_invalid:backend"],
  [
    "an open todo",
    { report: GOOD_REPORT.replace('"status":"done"', '"status":"open"') },
    "todo_open:T1",
  ],
  [
    "an unmet criterion",
    { report: GOOD_REPORT.replace('"met":true', '"met":false') },
    "criterion_unmet:K1",
  ],
  [
    "a criterion without evidence",
    { report: GOOD_REPORT.replace('"evidence":"logs"', '"evidence":""') },
    "criterion_unmet:K1",
  ],
  ["no report", { report: "No report." }, "report_missing"],
  [
    "an invalid report",
    { report: "```pages-report\nnot json\n```" },
    "report_invalid",
  ],
])("keeps Git blocked by %s", (_, changes, issue) => {
  expect(evaluateHandoff(handoff(changes), "pages", CURRENT)).toContain(issue);
});

it("judges the last report, as the acceptance of Pages does", () => {
  const text = `${handoff({})}\n${GOOD_REPORT.replace('"met":true', '"met":false')}`;

  expect(evaluateHandoff(text, "pages", CURRENT)).toContain(
    "criterion_unmet:K1",
  );
});

it("needs the coverage of both Pages scopes and the fingerprint of its own report", () => {
  const withoutFrontend = handoff({}).replace(/^coverage-frontend.*$/mu, "");

  expect(evaluateHandoff(withoutFrontend, "pages", CURRENT)).toEqual([
    "coverage_missing:frontend",
  ]);
  expect(evaluateHandoff(handoff({}), "mcp", CURRENT)).toEqual([
    "fingerprint_missing",
    "coverage_missing:mcp",
  ]);
});

it("releases Git for a complete MCP report, whose status may stand in a fence", () => {
  const text = [
    '```json\n{"status":"done"}\n```',
    `mcp-fingerprint: ${CURRENT}`,
    `coverage-mcp: ${TOTALS}`,
    GOOD_REPORT,
  ].join("\n");

  expect(evaluateHandoff(text, "mcp", CURRENT)).toEqual([]);
});

describe("counters that cannot be measurements", () => {
  it.each<[string, Record<string, unknown>]>([
    ["negative", { covered: -1, total: -1, skipped: 0 }],
    ["fractional", { covered: 1.5, total: 1.5, skipped: 0 }],
    ["infinite", { covered: Infinity, total: Infinity, skipped: 0 }],
    ["not a number", { covered: Number.NaN, total: Number.NaN, skipped: 0 }],
    ["text", { covered: "4", total: "4", skipped: 0 }],
    ["above the total", { covered: 5, total: 4, skipped: 0 }],
    ["fractional skipped", { covered: 4, total: 4, skipped: 0.5 }],
    ["negative skipped", { covered: 4, total: 4, skipped: -1 }],
    ["null", { covered: null, total: null }],
  ])("refuses %s counters in the total and in a file", (_, counter) => {
    const metrics = {
      statements: counter,
      branches: COMPLETE,
      functions: COMPLETE,
      lines: COMPLETE,
    };

    expect(evaluateCoverage({ total: metrics }).issues).toContain(
      "metric_invalid:statements",
    );
    expect(
      evaluateCoverage({ total: summary().total, "/repo/a.ts": metrics })
        .issues,
    ).toContain("file:/repo/a.ts:metric_invalid:statements");
  });

  it("refuses a file that is no object, without a metric or with skipped code", () => {
    const { total } = summary();

    expect(evaluateCoverage({ total, "/repo/a.ts": null }).issues).toContain(
      "file:/repo/a.ts:metric_missing:lines",
    );
    expect(
      evaluateCoverage({ total, "/repo/a.ts": withoutLines() }).issues,
    ).toContain("file:/repo/a.ts:metric_missing:lines");
    expect(
      evaluateCoverage(summary({ ...COMPLETE, skipped: 1 })).issues,
    ).toContain("file:/repo/a.ts:skipped:lines");
  });

  it("refuses a total that is not the sum of its files", () => {
    const { total } = summary();
    const file = summary({ covered: 3, total: 3, skipped: 0 }).total;

    expect(evaluateCoverage({ total, "/repo/a.ts": file }).issues).toEqual([
      "aggregate_mismatch:statements",
      "aggregate_mismatch:branches",
      "aggregate_mismatch:functions",
      "aggregate_mismatch:lines",
    ]);
  });
});

describe("population of the coverage scopes", () => {
  it.each([
    ["backend", backendConfig],
    ["frontend", frontendConfig],
  ] as const)(
    "names the same files as the %s configuration",
    (scope, config) => {
      const coverage: unknown = config.test?.coverage;
      if (
        typeof coverage !== "object" ||
        coverage === null ||
        !("provider" in coverage) ||
        coverage.provider !== "v8" ||
        !("include" in coverage)
      ) {
        throw new Error("Expected v8 coverage configuration.");
      }

      expect(COVERAGE_POPULATIONS[scope].include).toEqual(coverage.include);
      expect(COVERAGE_POPULATIONS[scope].exclude).toEqual(
        "exclude" in coverage ? (coverage.exclude ?? []) : [],
      );
    },
  );

  it("matches the independent MCP configuration without executing it", () => {
    const config = readFileSync("mcp/vitest.config.ts", "utf8");
    const include = ["src/**/*.ts", "scripts/**/*.ts", "build.config.ts"];

    expect(config).toContain(
      'include: ["src/**/*.ts", "scripts/**/*.ts", "build.config.ts"]',
    );
    expect(COVERAGE_POPULATIONS.mcp.include).toEqual(include);
    expect(COVERAGE_POPULATIONS.mcp.exclude).toEqual([]);
  });

  const FILES = [
    "backend/a.ts",
    "app/lib/b.server.ts",
    "app/components/c.tsx",
    "tests/backend/d.ts",
  ];

  it("accepts a summary with exactly the expected files", () => {
    expect(
      populationIssues(
        ["/repo/backend/a.ts", "/repo/app/lib/b.server.ts"],
        FILES,
        "backend",
        "/repo",
      ),
    ).toEqual([]);
  });

  it("refuses a summary that lacks a file or has another", () => {
    expect(
      populationIssues(
        ["/repo/backend/a.ts", "/repo/tests/backend/d.ts"],
        FILES,
        "backend",
        "/repo",
      ),
    ).toEqual([
      "population_missing:app/lib/b.server.ts",
      "population_extra:tests/backend/d.ts",
    ]);
  });

  it("keeps server modules out of the frontend scope", () => {
    expect(
      populationIssues(
        ["/repo/app/components/c.tsx"],
        FILES,
        "frontend",
        "/repo",
      ),
    ).toEqual([]);
  });
});

describe("the checkout behind a fingerprint", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pages-evidence-unit-"));
    await place("backend/A.ts");
    await place("mcp/src/server.ts");
    await place("mcp/tests/client.ts");
    await place("mcp/package.json");
    await place("mcp/node_modules/.pnpm/lock.yaml", "mcp-lock");
    await place("node_modules/.pnpm/lock.yaml", "pages-lock");
    await place("package.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function place(file: string, content = "x"): Promise<void> {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  const noGit = (): readonly string[] => [];

  function fingerprint(scope: "pages" | "mcp"): string {
    return currentManifest(root, scope, noGit).fingerprint;
  }

  function manifest(): string {
    return currentManifest(root, "pages", noGit).manifest;
  }

  it("counts a source file no matter which ignore rule would match it", async () => {
    await place(".gitignore", "*.ts\nignored/\n");
    const before = fingerprint("pages");

    await place("backend/Ignored.ts");
    await place("ignored/Kept.tsx");
    await place("data/seed.ts");
    await place("app/odd [name] ä\nline.ts");

    expect(fingerprint("pages")).not.toBe(before);
    expect(manifest()).toContain("backend/Ignored.ts\0");
    expect(manifest()).toContain("ignored/Kept.tsx\0");
    expect(manifest()).toContain("data/seed.ts\0");
    expect(manifest()).toContain("app/odd [name] ä\nline.ts\0");
  });

  it("counts tracked files an ignore rule matches and marks deleted ones", () => {
    const tracked = (): readonly string[] => [
      "backend/A.ts",
      "backend/Gone.ts",
    ];

    expect(currentManifest(root, "pages", tracked).manifest).toContain(
      "backend/Gone.ts\0DELETED",
    );
  });

  it("works without Git and leaves generated output and local state out", async () => {
    const before = fingerprint("pages");

    await place("coverage/backend/report.js");
    await place("build/server/index.js");
    await place("mcp/dist/bundle.cjs");
    await place("tests/browser/results/report/trace/generated.js");
    await place("mobile/app.ts");
    await place("data/pages.duckdb");
    await place(".env");
    await place("server.log");

    expect(fingerprint("pages")).toBe(before);
  });
});

describe("a QA report bound to the checkout", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pages-handoff-unit-"));
    await place("backend/A.ts");
    await place("mcp/src/server.ts");
    await place("mcp/tests/client.ts");
    await place("mcp/package.json");
    await place("mcp/node_modules/.pnpm/lock.yaml", "mcp-lock");
    await place("node_modules/.pnpm/lock.yaml", "pages-lock");
    await place("package.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function place(file: string, content = "x"): Promise<void> {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  const noGit = (): readonly string[] => [];

  function fingerprint(scope: "pages" | "mcp"): string {
    return currentManifest(root, scope, noGit).fingerprint;
  }

  const FRESH_LINES = JSON.stringify(summary().total);

  function report(kind: "pages" | "mcp"): string {
    const lines =
      kind === "pages"
        ? [
            `coverage-backend: ${FRESH_LINES}`,
            `coverage-frontend: ${FRESH_LINES}`,
          ]
        : [`coverage-mcp: ${FRESH_LINES}`];
    return [
      '{"status":"done"}',
      `${kind}-fingerprint: ${fingerprint(kind)}`,
      ...lines,
      GOOD_REPORT,
    ].join("\n");
  }

  function released(kind: "pages" | "mcp", text: string): readonly string[] {
    return handoffIssues(root, kind, text, noGit);
  }

  it.each(["pages", "mcp"] as const)(
    "releases Git for a fresh %s report on the unchanged checkout",
    (kind) => {
      expect(released(kind, report(kind))).toEqual([]);
    },
  );

  it.each<[string, string, "pages" | "mcp"]>([
    ["a source file", "backend/A.ts", "pages"],
    ["the configuration", "package.json", "pages"],
    ["the installed dependencies", "node_modules/.pnpm/lock.yaml", "pages"],
    ["shared MCP source", "mcp/src/server.ts", "pages"],
    ["shared MCP source", "mcp/src/server.ts", "mcp"],
    ["an MCP test", "mcp/tests/client.ts", "mcp"],
    ["the MCP dependencies", "mcp/node_modules/.pnpm/lock.yaml", "mcp"],
  ])(
    "refuses a report after a change of %s (%s, %s)",
    async (_, file, kind) => {
      const text = report(kind);

      await place(file, "changed");

      expect(released(kind, text)).toEqual(["fingerprint_stale"]);
    },
  );

  it("refuses a report after a new source file, also an ignored one", async () => {
    const text = report("pages");

    await place(".gitignore", "*.ts\n");
    await place("backend/New.ts");

    expect(released("pages", text)).toContain("fingerprint_stale");
  });

  it("keeps Pages evidence valid after a change of an MCP test only", async () => {
    const text = report("pages");

    await place("mcp/tests/client.ts", "changed");

    expect(released("pages", text)).toEqual([]);
  });
});
