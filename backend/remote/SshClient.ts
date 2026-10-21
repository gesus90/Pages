import { setTimeout as wait } from "node:timers/promises";

import { logCaughtError } from "@/backend/logging/Logger";

import { classifyKeyFailure, classifySshFailure } from "./SshFailure";
import { knownHostsLine, preferredHostKey } from "./SshHostKey";
import {
  connectArguments,
  multiplexArguments,
  promptSecret,
  sshEnvironment,
  SSH_CONNECT_TIMEOUT_SECONDS,
} from "./SshOptions";
import { SshChildProcess, runSshProcess } from "./SshProcess";
import { probeSshEndpoint } from "./SshProbe";
import { SshRuntimeDirectory } from "./SshRuntimeDirectory";

import type {
  RemoteFailureCode,
  RemoteHostKey,
} from "@/definition/RemoteConnection";
import type { SshFiles, SshTarget } from "./SshOptions";
import type { SshProcessResult } from "./SshProcess";
import type { SshEndpoint } from "./SshProbe";
import type { SshScope } from "./SshRuntimeDirectory";

/** The OpenSSH programs Pages runs; they are looked up on the server's search path. */
export interface SshTools {
  readonly ssh: string;
  readonly keyscan: string;
  readonly keygen: string;
}

/** An open logical connection; commands share its authenticated transport. */
export interface SshMaster {
  /** Settles when the transport ends, whether closed or lost. */
  readonly exited: Promise<SshProcessResult>;
  /** Runs one command on the machine; exit code 255 means the transport failed. */
  run(command: string, timeoutMs: number): Promise<SshProcessResult>;
  /** Ends the transport on purpose and removes its private files. */
  close(): Promise<void>;
}

/** A started connection or the reason it could not be started. */
export type SshMasterResult =
  | { readonly master: SshMaster; readonly failure: null }
  | { readonly master: null; readonly failure: RemoteFailureCode };

const DEFAULT_TOOLS: SshTools = {
  ssh: "ssh",
  keyscan: "ssh-keyscan",
  keygen: "ssh-keygen",
};
const KEY_FILE = "identity";
const KNOWN_HOSTS_FILE = "known_hosts";
const CONTROL_SOCKET = "control";
const COMMAND_TIMEOUT_MILLISECONDS = 30_000;
const CHECK_INTERVAL_MILLISECONDS = 250;
const MASTER_START_MILLISECONDS = (SSH_CONNECT_TIMEOUT_SECONDS + 20) * 1000;

/** OpenSSH requires a key file to end with a line break. */
function keyFileContent(privateKey: string): string {
  return `${privateKey.replaceAll("\r\n", "\n").trim()}\n`;
}

class SshMasterConnection implements SshMaster {
  public readonly exited: Promise<SshProcessResult>;
  private readonly masterProcess: SshChildProcess;
  private readonly commandArguments: readonly string[];
  private readonly scope: SshScope;
  private readonly tools: SshTools;

  public constructor(input: {
    readonly masterProcess: SshChildProcess;
    readonly commandArguments: readonly string[];
    readonly scope: SshScope;
    readonly tools: SshTools;
  }) {
    this.masterProcess = input.masterProcess;
    this.commandArguments = input.commandArguments;
    this.scope = input.scope;
    this.tools = input.tools;
    this.exited = input.masterProcess.exited;
    void this.exited.then(() => this.scope.remove());
  }

  /** Runs one command through the control socket. */
  public async run(
    command: string,
    timeoutMs: number,
  ): Promise<SshProcessResult> {
    return runSshProcess({
      file: this.tools.ssh,
      arguments: [...this.commandArguments, command],
      environment: sshEnvironment(this.scope.askpass, null),
      timeoutMs,
    });
  }

  /** Stops the master; its scope is removed once it has ended. */
  public async close(): Promise<void> {
    this.masterProcess.stop();
    await this.exited;
  }
}

/**
 * Reaches remote machines with the OpenSSH client of the server.
 *
 * @remarks
 * Every run ignores the server account's own SSH configuration, keys, agent
 * and `known_hosts`; it accepts only the pinned host key and tries only the
 * configured sign-in method. Secrets reach OpenSSH through a private askpass
 * helper or a private key file that is removed right after use.
 */
export class SshClient {
  private readonly runtime: SshRuntimeDirectory;
  private readonly tools: SshTools;

  public constructor(
    runtime: SshRuntimeDirectory = new SshRuntimeDirectory(),
    tools: SshTools = DEFAULT_TOOLS,
  ) {
    this.runtime = runtime;
    this.tools = tools;
  }

  /** Checks that an SSH server answers on the endpoint, without signing in. */
  public async probe(endpoint: SshEndpoint): Promise<RemoteFailureCode | null> {
    return probeSshEndpoint(endpoint);
  }

  /**
   * Reads the host key the machine presents, for a person to confirm or compare.
   *
   * @param endpoint - Host and port.
   * @returns The strongest key offered, or the failure.
   */
  public async scanHostKey(
    endpoint: SshEndpoint,
  ): Promise<RemoteHostKey | RemoteFailureCode> {
    const result = await runSshProcess({
      file: this.tools.keyscan,
      arguments: [
        "-T",
        String(SSH_CONNECT_TIMEOUT_SECONDS),
        "-p",
        String(endpoint.port),
        "-t",
        "ed25519,ecdsa,rsa",
        "--",
        endpoint.host,
      ],
      environment: sshEnvironment("/bin/false", null),
      timeoutMs: (SSH_CONNECT_TIMEOUT_SECONDS + 5) * 1000,
    });
    if (result.isUnavailable) return "ssh_unavailable";
    return preferredHostKey(result.stdout) ?? "host_key_unavailable";
  }

  /**
   * Signs in once and runs `true`, which proves the account, the method and the pinned key.
   *
   * @param target - Machine, account, pinned key and credentials.
   * @returns `null` on success, otherwise the classified failure.
   */
  public async authenticate(
    target: SshTarget,
  ): Promise<RemoteFailureCode | null> {
    const scope = await this.runtime.createScope();
    try {
      const prepared = await this.prepare(scope, target);
      if (prepared.failure) return prepared.failure;
      const result = await runSshProcess({
        file: this.tools.ssh,
        arguments: [
          ...connectArguments(target, prepared.files),
          "--",
          target.host,
          "true",
        ],
        environment: sshEnvironment(
          scope.askpass,
          promptSecret(target.credentials),
        ),
        timeoutMs: COMMAND_TIMEOUT_MILLISECONDS,
      });
      return classifySshFailure(result, target.credentials.method);
    } finally {
      await scope.remove();
    }
  }

  /**
   * Opens a logical connection whose transport is watched by keepalive probes.
   *
   * @param target - Machine, account, pinned key and credentials.
   * @returns The open connection, or why it could not be opened.
   */
  public async openMaster(target: SshTarget): Promise<SshMasterResult> {
    const scope = await this.runtime.createScope();
    try {
      const prepared = await this.prepare(scope, target);
      if (prepared.failure) {
        await scope.remove();
        return { master: null, failure: prepared.failure };
      }
      return await this.startMaster(scope, target, prepared.files);
    } catch (error: unknown) {
      await scope.remove();
      throw error;
    }
  }

  /** Removes all private files; called when the server stops. */
  public async dispose(): Promise<void> {
    await this.runtime.dispose();
  }

  private async startMaster(
    scope: SshScope,
    target: SshTarget,
    files: SshFiles,
  ): Promise<SshMasterResult> {
    const controlPath = `${scope.directory}/${CONTROL_SOCKET}`;
    const masterProcess = new SshChildProcess({
      file: this.tools.ssh,
      arguments: [
        ...connectArguments(target, files),
        "-M",
        "-N",
        "-S",
        controlPath,
        "-o",
        "ControlPersist=no",
        "--",
        target.host,
      ],
      environment: sshEnvironment(
        scope.askpass,
        promptSecret(target.credentials),
      ),
      timeoutMs: null,
    });
    const isReady = await this.awaitControlSocket(
      masterProcess,
      controlPath,
      target,
    );
    // The key is only needed for the sign-in, which is over once the socket answers.
    await scope.discard(KEY_FILE);
    if (!isReady) {
      masterProcess.stop();
      const result = await masterProcess.exited;
      await scope.remove();
      return {
        master: null,
        failure:
          classifySshFailure(result, target.credentials.method) ??
          "remote_failed",
      };
    }
    const master = new SshMasterConnection({
      masterProcess,
      commandArguments: [
        ...multiplexArguments(target, files, controlPath),
        "--",
        target.host,
      ],
      scope,
      tools: this.tools,
    });
    return { master, failure: null };
  }

  private async awaitControlSocket(
    masterProcess: SshChildProcess,
    controlPath: string,
    target: SshTarget,
  ): Promise<boolean> {
    let hasExited = false;
    void masterProcess.exited.then(() => {
      hasExited = true;
    });
    const deadline = Date.now() + MASTER_START_MILLISECONDS;
    while (!hasExited && Date.now() < deadline) {
      const check = await runSshProcess({
        file: this.tools.ssh,
        arguments: [
          "-F",
          "/dev/null",
          "-S",
          controlPath,
          "-O",
          "check",
          "--",
          target.host,
        ],
        environment: sshEnvironment("/bin/false", null),
        timeoutMs: 5_000,
      });
      if (check.exitCode === 0) return !hasExited;
      await wait(CHECK_INTERVAL_MILLISECONDS);
    }
    return false;
  }

  /** Writes the pinned key and the key file, and proves the key can be read. */
  private async prepare(
    scope: SshScope,
    target: SshTarget,
  ): Promise<
    | { readonly files: SshFiles; readonly failure: null }
    | { readonly files: null; readonly failure: RemoteFailureCode }
  > {
    const knownHosts = await scope.write(
      KNOWN_HOSTS_FILE,
      knownHostsLine(target.alias, target.hostKey),
    );
    const { credentials } = target;
    if (credentials.method === "password")
      return credentials.password
        ? { files: { knownHosts, key: null }, failure: null }
        : { files: null, failure: "secret_missing" };
    if (!credentials.privateKey)
      return { files: null, failure: "secret_missing" };
    const key = await scope.write(
      KEY_FILE,
      keyFileContent(credentials.privateKey),
    );
    const failure = await this.verifyKey(scope, key, target);
    return failure
      ? { files: null, failure }
      : { files: { knownHosts, key }, failure: null };
  }

  /** Reading the key locally tells a wrong passphrase apart from a refused key. */
  private async verifyKey(
    scope: SshScope,
    keyFile: string,
    target: SshTarget,
  ): Promise<RemoteFailureCode | null> {
    try {
      const result = await runSshProcess({
        file: this.tools.keygen,
        arguments: ["-y", "-f", keyFile],
        environment: sshEnvironment(
          scope.askpass,
          promptSecret(target.credentials),
        ),
        timeoutMs: 15_000,
      });
      return classifyKeyFailure(result, target.credentials.method);
    } catch (error: unknown) {
      logCaughtError("SshClient", error);
      return "key_invalid";
    }
  }
}
