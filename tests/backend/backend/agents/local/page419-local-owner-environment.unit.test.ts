import { beforeEach, expect, it, vi } from "vitest";
import path from "node:path";

import { startLocalSessionUnit } from "@/backend/agents/local/LocalSessionUnit";

import { SYSTEMD_ENVIRONMENT } from "../page419-environment-fixture";
import { MANIFEST } from "./local-sessions-fixture";

const boundary = vi.hoisted(() => ({
  command: vi.fn<
    (
      file: string,
      args: readonly string[],
    ) => Promise<{ stdout: string; stderr: string }>
  >(async () => ({ stdout: "", stderr: "" })),
  writeFile:
    vi.fn<(file: string, content: string, options: unknown) => Promise<void>>(),
}));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: boundary.command }),
  };
});
vi.mock("node:fs/promises", () => ({
  writeFile: boundary.writeFile,
  rm: vi.fn(),
}));
vi.mock("@/backend/agents/local/LocalSessionOwnership", () => ({
  localManagerEnvironment: () => ({ PATH: "/usr/bin:/bin" }),
}));

beforeEach(() => {
  boundary.command.mockClear();
  boundary.writeFile.mockClear();
  for (const name of Object.keys(process.env)) vi.stubEnv(name, undefined);
  const inherited = {
    ...SYSTEMD_ENVIRONMENT,
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    PAGES_FULL_ENVIRONMENT_OWNER_ID: "owner",
    HOST_LOGIN_SETTING: "preserved",
  };
  for (const [name, configured] of Object.entries(inherited))
    vi.stubEnv(name, configured);
});

it("omits every parent systemd variable from the full-environment owner file", async () => {
  await startLocalSessionUnit({
    ...MANIFEST,
    launch: { ...MANIFEST.launch, isFullEnvironment: true },
  });

  const content: unknown = boundary.writeFile.mock.calls[0]?.[1];
  expect(typeof content).toBe("string");
  expect(content).toContain('HOST_LOGIN_SETTING="preserved"');
  expect(content).toContain('HOME="/synthetic/home"');
  for (const name of Object.keys(SYSTEMD_ENVIRONMENT))
    expect(content).not.toContain(`${name}=`);
  expect(boundary.writeFile).toHaveBeenCalledWith(
    `${MANIFEST.directory}/owner.env`,
    content,
    { flag: "wx", mode: 0o600 },
  );
  expect(boundary.command).toHaveBeenCalledTimes(2);
});

it("keeps the isolated owner file restricted to the existing allowlist", async () => {
  await startLocalSessionUnit(MANIFEST);

  expect(boundary.writeFile).toHaveBeenCalledWith(
    `${MANIFEST.directory}/owner.env`,
    'NODE_ENV="development"\nLANG="C.UTF-8"\nPAGES_LOCAL_OWNER_SOURCE="1"\nPATH="/synthetic/bin"\nHOME="/synthetic/home"\nPAGES_FULL_ENVIRONMENT_OWNER_ID="owner"\n',
    { flag: "wx", mode: 0o600 },
  );
});

it("starts the source owner from the project entrypoint", async () => {
  await startLocalSessionUnit(MANIFEST);

  const launch = boundary.command.mock.calls[1]?.[1];
  expect(launch).toContain(path.resolve(process.cwd(), "local-agent.mjs"));
  expect(launch).toContain("MemoryMax=1536M");
});
