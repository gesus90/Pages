import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type * as CryptoModule from "node:crypto";
import type * as FsModule from "node:fs";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  reportedSize: null as number | null,
  failMode: null as number | null,
  fixedUuid: null as string | null,
}));

vi.mock("@/backend/agents/acp/PicaCodexAdapterPatch", () => ({
  patchPicaCodexAdapter: mocks.patch,
  PICA_CODEX_ADAPTER_VERSION: "9.9.9",
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  return {
    ...actual,
    fstatSync: (handle: number) => {
      const facts = actual.fstatSync(handle);
      return mocks.reportedSize !== null && facts.isFile()
        ? Object.create(facts, { size: { value: mocks.reportedSize } })
        : facts;
    },
    fchmodSync: (handle: number, mode: number) => {
      if (mode === mocks.failMode) throw new Error("synthetic chmod failure");
      actual.fchmodSync(handle, mode);
    },
  };
});
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return {
    ...actual,
    randomUUID: () => mocks.fixedUuid ?? actual.randomUUID(),
  };
});

import {
  preparePicaCodexBundle,
  requirePicaCodexProfile,
} from "./PicaCodexBundle";

const LICENSE = "Apache License\nCopyright JetBrains s.r.o.";
const FEATURES = [
  "shell_tool",
  "unified_exec",
  "view_image",
  "js_repl",
  "code_mode",
  "apps",
  "plugins",
  "multi_agent",
];

let base = "";
let workspace = "";
let adapter = "";

function profile(features: unknown, webSearch: unknown = "disabled"): unknown {
  return { configuration: { web_search: webSearch, features } };
}

function disabledFeatures(): Record<string, boolean> {
  return Object.fromEntries(FEATURES.map((name) => [name, false]));
}

beforeEach(() => {
  mocks.patch.mockReset();
  mocks.patch.mockReturnValue("patched");
  mocks.reportedSize = null;
  mocks.failMode = null;
  mocks.fixedUuid = null;
  const parent = pagesTempDirectory("pica-codex-bundle-tests");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  base = mkdtempSync(path.join(parent, "case-"));
  workspace = path.join(base, "workspace");
  mkdirSync(workspace, { mode: 0o700 });
  chmodSync(workspace, 0o700);
  const packageRoot = path.join(base, "package");
  mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  adapter = path.join(packageRoot, "dist", "index.js");
  writeFileSync(adapter, "bundle");
  writeFileSync(path.join(packageRoot, "package.json"), "{}");
  writeFileSync(path.join(packageRoot, "LICENSE"), LICENSE);
});

afterEach(() => {
  mocks.reportedSize = null;
  mocks.failMode = null;
  for (const entry of readdirSync(workspace)) {
    chmodSync(path.join(workspace, entry), 0o700);
  }
  rmSync(base, { recursive: true, force: true });
});

it("accepts the managed profile that disables every known tool", () => {
  expect(() =>
    requirePicaCodexProfile(profile(disabledFeatures())),
  ).not.toThrow();
});

it("refuses profiles that widen the tool configuration", () => {
  const widened = { ...disabledFeatures(), shell_tool: true };
  const extra = { ...disabledFeatures(), extra: false };
  for (const invalid of [
    null,
    "profile",
    {},
    { configuration: null },
    { configuration: { web_search: "live" } },
    profile(null),
    profile([]),
    profile(widened),
    profile(extra),
    profile({}, "disabled"),
    profile(disabledFeatures(), "live"),
  ])
    expect(() => requirePicaCodexProfile(invalid)).toThrow(
      "Invalid Pica Codex profile",
    );
});

it("builds a read-only bundle with notice and provenance and removes it again", () => {
  writeFileSync(path.join(base, "package", "NOTICE"), "notice");
  const bundle = preparePicaCodexBundle(workspace, adapter, "/runner");
  expect(bundle.version).toBe("9.9.9");
  expect(bundle.packageRoot).toBe(path.join(base, "package"));
  expect(bundle.runnerRoot).toBe("/runner");
  expect(bundle.entry).toBe(path.join(bundle.directory, "adapter.mjs"));
  expect(readFileSync(bundle.entry, "utf8")).toBe("patched");
  expect(readdirSync(bundle.directory).sort()).toEqual([
    "LICENSE",
    "NOTICE",
    "adapter.mjs",
    "glue.mjs",
    "provenance.json",
  ]);
  expect(lstatSync(bundle.directory).mode & 0o777).toBe(0o500);
  bundle.cleanup();
  bundle.cleanup();
  expect(readdirSync(bundle.directory)).toEqual([]);
});

it("builds a bundle without a notice file", () => {
  const bundle = preparePicaCodexBundle(workspace, adapter, "/runner");
  expect(readdirSync(bundle.directory)).not.toContain("NOTICE");
  bundle.cleanup();
});

it("refuses unusable workspaces", () => {
  expect(() => preparePicaCodexBundle("relative", adapter, "/r")).toThrow(
    "Invalid Pica workspace",
  );
  expect(() =>
    preparePicaCodexBundle(`${workspace}/../workspace`, adapter, "/r"),
  ).toThrow("Invalid Pica workspace");
  expect(() =>
    preparePicaCodexBundle(path.join(base, "missing"), adapter, "/r"),
  ).toThrow();
  chmodSync(workspace, 0o755);
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Invalid Pica workspace",
  );
});

it("refuses adapters that are not the expected package layout", () => {
  const other = path.join(base, "package", "dist", "other.js");
  writeFileSync(other, "x");
  expect(() => preparePicaCodexBundle(workspace, other, "/r")).toThrow(
    "Unsupported Codex adapter",
  );
  const loose = path.join(base, "package", "index.js");
  writeFileSync(loose, "x");
  expect(() => preparePicaCodexBundle(workspace, loose, "/r")).toThrow(
    "Unsupported Codex adapter",
  );
});

it("refuses adapter files that are empty, oversized or not regular", () => {
  const packageJson = path.join(base, "package", "package.json");
  writeFileSync(packageJson, "");
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Invalid adapter file",
  );
  writeFileSync(packageJson, "x".repeat(256 * 1024 + 1));
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Invalid adapter file",
  );
  mocks.reportedSize = 1;
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Invalid adapter file",
  );
  mocks.reportedSize = null;
  writeFileSync(packageJson, "{}");
  rmSync(path.join(base, "package", "NOTICE"), { force: true });
  mkdirSync(path.join(base, "package", "NOTICE"));
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Invalid adapter file",
  );
});

it("refuses a license that is not the expected Apache license", () => {
  const license = path.join(base, "package", "LICENSE");
  writeFileSync(license, "JetBrains only");
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Unsupported Codex adapter license",
  );
  writeFileSync(license, "Apache License only");
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Unsupported Codex adapter license",
  );
});

it("leaves nothing behind when patching fails", () => {
  mocks.patch.mockImplementation(() => {
    throw new Error("Unsupported Codex adapter bundle");
  });
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "Unsupported Codex adapter bundle",
  );
  const [created] = readdirSync(workspace);
  expect(readdirSync(path.join(workspace, created))).toEqual([]);
});

it("removes written files when sealing the directory fails", () => {
  mocks.failMode = 0o500;
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    "synthetic chmod failure",
  );
  const [created] = readdirSync(workspace);
  expect(readdirSync(path.join(workspace, created))).toEqual([]);
});

it("fails without cleanup when the private directory cannot be created", () => {
  mocks.fixedUuid = "fixed";
  const bundle = preparePicaCodexBundle(workspace, adapter, "/r");
  expect(() => preparePicaCodexBundle(workspace, adapter, "/r")).toThrow(
    /EEXIST/,
  );
  bundle.cleanup();
});

it("refuses to remove a directory that was replaced", () => {
  const bundle = preparePicaCodexBundle(workspace, adapter, "/r");
  chmodSync(bundle.directory, 0o700);
  const moved = `${bundle.directory}-moved`;
  renameSync(bundle.directory, moved);
  mkdirSync(bundle.directory, { mode: 0o700 });
  expect(() => bundle.cleanup()).toThrow("Pica adapter directory changed");
  rmSync(bundle.directory, { recursive: true });
  renameSync(moved, bundle.directory);
  writeFileSync(`${bundle.directory}.file`, "x");
  rmSync(bundle.directory, { recursive: true });
  renameSync(`${bundle.directory}.file`, bundle.directory);
  expect(() => bundle.cleanup()).toThrow("Pica adapter directory changed");
});

it("refuses to remove files that were replaced, linked or are not regular", () => {
  const bundle = preparePicaCodexBundle(workspace, adapter, "/r");
  chmodSync(bundle.directory, 0o700);
  const glue = path.join(bundle.directory, "glue.mjs");
  const license = path.join(bundle.directory, "LICENSE");
  const adapterFile = path.join(bundle.directory, "adapter.mjs");
  const copy = readFileSync(glue);
  writeFileSync(`${glue}.new`, copy);
  renameSync(`${glue}.new`, glue);
  expect(() => bundle.cleanup()).toThrow("Pica adapter artifact changed");
  const outside = path.join(base, "outside");
  writeFileSync(outside, "x");
  unlinkSync(adapterFile);
  symlinkSync(outside, adapterFile);
  expect(() => bundle.cleanup()).toThrow("Pica adapter artifact changed");
  linkSync(license, path.join(base, "second-link"));
  expect(() => bundle.cleanup()).toThrow("Pica adapter artifact changed");
});
