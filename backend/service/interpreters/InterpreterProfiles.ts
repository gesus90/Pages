import { createHash } from "node:crypto";
import path from "node:path";

import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { interpreterProfilesSchema } from "@/definition/InterpreterProfile";

import { checkInterpreterVersion } from "./InterpreterVersionCheck";

import type { ConfigFile } from "@/backend/config/ConfigFile";
import type {
  InterpreterCheck,
  InterpreterProfile,
  InterpreterSnapshot,
} from "@/definition/InterpreterProfile";

/** Stable error codes for validation, stale snapshots and unavailable executables. */
export class InterpreterSettingsError extends Error {
  public readonly code: "invalid" | "conflict" | "unchecked";

  public readonly checks: Readonly<Record<string, InterpreterCheck>>;

  public constructor(
    code: "invalid" | "conflict" | "unchecked",
    checks: Readonly<Record<string, InterpreterCheck>> = {},
  ) {
    super(code);
    this.code = code;
    this.checks = checks;
  }
}

function revision(profiles: readonly InterpreterProfile[]): string {
  return createHash("sha256").update(JSON.stringify(profiles)).digest("hex");
}

/** Owns startup observations and the existing instance TOML profile configuration. */
export class InterpreterProfiles {
  private readonly configFile: ConfigFile;
  private defaults: readonly InterpreterProfile[] = [];
  private readonly checks = new Map<string, InterpreterCheck>();
  private starting: Promise<void> | null = null;

  public constructor(configFile: ConfigFile) {
    this.configFile = configFile;
  }

  /** Discovers only the three desired defaults and checks saved concrete paths on startup. */
  public async initialize(): Promise<void> {
    this.starting ??= this.checkStartupProfiles();
    await this.starting;
  }

  /** Returns current names/paths and only observations for those exact paths. */
  public async snapshot(): Promise<InterpreterSnapshot> {
    await this.initialize();
    const profiles = await this.readProfiles();
    const checks: Record<string, InterpreterCheck> = {};
    for (const profile of profiles) {
      const check = this.checks.get(profile.path);
      if (check) checks[profile.id] = check;
    }
    return { profiles, checks, revision: revision(profiles) };
  }

  /** A check is an observation only; it never writes configuration. */
  public async check(programPath: string): Promise<InterpreterCheck> {
    const result = await checkInterpreterVersion(programPath);
    this.checks.set(programPath, result);
    return result;
  }

  /** Rechecks changed programs and atomically rejects concurrent profile edits. */
  public async save(
    input: unknown,
    expectedRevision: string,
  ): Promise<InterpreterSnapshot> {
    await this.initialize();
    const parsed = interpreterProfilesSchema.safeParse(input);
    if (!parsed.success) throw new InterpreterSettingsError("invalid");
    const current = await this.readProfiles();
    if (revision(current) !== expectedRevision)
      throw new InterpreterSettingsError("conflict");
    if (
      current.some(
        (profile) =>
          !parsed.data.some((candidate) => candidate.id === profile.id),
      )
    )
      throw new InterpreterSettingsError("invalid");
    const changed = parsed.data.filter(
      (profile) =>
        !current.some(
          (saved) => JSON.stringify(saved) === JSON.stringify(profile),
        ),
    );
    const checks = await Promise.all(
      changed.map((profile) => this.check(profile.path)),
    );
    if (checks.some((check) => check.status !== "ok")) {
      const observations: Record<string, InterpreterCheck> = {};
      changed.forEach((profile, index) => {
        const observation = checks[index];
        if (observation) observations[profile.id] = observation;
      });
      throw new InterpreterSettingsError("unchecked", observations);
    }
    await this.configFile.update((config) => {
      if (
        revision(config.interpreterProfiles ?? this.defaults) !==
        expectedRevision
      )
        throw new InterpreterSettingsError("conflict");
      return { ...config, interpreterProfiles: parsed.data };
    });
    return this.snapshot();
  }

  private async checkStartupProfiles(): Promise<void> {
    const locator = new CliLocator();
    const searchDirectory =
      (process.env.PATH ?? "")
        .split(path.delimiter)
        .find((directory) => path.isAbsolute(directory)) ??
      path.dirname(process.execPath);
    this.defaults = await Promise.all(
      [
        { id: "python3", name: "Python 3", binary: "python3" },
        { id: "bash", name: "Bash", binary: "bash" },
        { id: "node", name: "Node.js", binary: "node" },
      ].map(async (profile) => ({
        id: profile.id,
        name: profile.name,
        path:
          (await locator.locate(profile.binary)).path ??
          path.join(searchDirectory, profile.binary),
      })),
    );
    const profiles = await this.readProfiles();
    await Promise.all(profiles.map((profile) => this.check(profile.path)));
  }
  private async readProfiles(): Promise<readonly InterpreterProfile[]> {
    const config = await this.configFile.read();
    return config?.interpreterProfiles ?? this.defaults;
  }
}
