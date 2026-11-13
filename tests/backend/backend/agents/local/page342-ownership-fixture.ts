import { vi } from "vitest";

import { MANIFEST, PROOF } from "./local-sessions-fixture";

/** Synthetic process evidence; no /proc or service-manager access is needed. */
export const OWNER_PROOF = {
  ...PROOF,
  instanceKey: MANIFEST.instanceKey,
  uid: process.getuid?.() ?? PROOF.uid,
  arguments: ["node", MANIFEST.directory, MANIFEST.configPath],
};

/** Mutable kernel evidence lets a retry encounter a reused process identity. */
export const identity = { start: OWNER_PROOF.start };

/** Every operating-system boundary used by the ownership proof. */
export const boundaries = {
  show: vi.fn<(...arguments_: unknown[]) => Promise<{ stdout: string }>>(),
  readFile:
    vi.fn<(file: string, encoding?: string) => Promise<string | Buffer>>(),
  stat: vi.fn<() => Promise<{ uid: number }>>(),
  record: vi.fn<(file: string) => Promise<unknown>>(),
};

/** A successful systemctl response, optionally describing a different owner. */
export function unitResponse(
  overrides: Readonly<Record<string, string>> = {},
): { stdout: string } {
  const properties = {
    MainPID: String(OWNER_PROOF.pid),
    InvocationID: OWNER_PROOF.invocationId,
    ControlGroup: OWNER_PROOF.cgroup,
    ActiveState: "active",
    ...overrides,
  };
  return {
    stdout: Object.entries(properties)
      .map(([name, content]) => `${name}=${content}`)
      .join("\n"),
  };
}

/** Restores one internally consistent owner without real files or processes. */
export function resetOwnerEvidence(): void {
  vi.resetAllMocks();
  identity.start = OWNER_PROOF.start;
  boundaries.show.mockResolvedValue(unitResponse());
  boundaries.stat.mockResolvedValue({ uid: OWNER_PROOF.uid });
  boundaries.record.mockImplementation(async (file) => {
    if (file.endsWith("/manifest.json")) return MANIFEST;
    if (file.endsWith("/proof.json")) return OWNER_PROOF;
    throw new Error(`Unexpected ownership record: ${file}`);
  });
  boundaries.readFile.mockImplementation(async (file, encoding) => {
    if (file === "/proc/sys/kernel/random/boot_id") return OWNER_PROOF.boot;
    if (file === `/proc/${OWNER_PROOF.pid}/cgroup`)
      return `0::${OWNER_PROOF.cgroup}\n`;
    if (file === `/proc/${OWNER_PROOF.pid}/cmdline`) {
      const command = `${OWNER_PROOF.arguments.join("\0")}\0`;
      return encoding ? command : Buffer.from(command);
    }
    if (file === `/proc/${OWNER_PROOF.pid}/stat`) {
      const fields = ["S", ...Array<string>(18).fill("0"), String(identity.start)];
      return `${OWNER_PROOF.pid} (synthetic owner) ${fields.join(" ")}`;
    }
    throw new Error(`Unexpected process read: ${file}`);
  });
}
