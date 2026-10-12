import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import manifest from "../package.json" with { type: "json" };
import { CredentialStore, CredentialStoreError } from "./credential-store.js";
import { credentialMessages } from "./credential-messages.js";
import { instanceEndpoint, readInstanceUrl } from "./instance-address.js";
import { openPairingBrowser } from "./pairing-browser.js";
import { PairingClient, PairingClientError } from "./pairing-client.js";
import { postAgentRequest } from "./pages-client.js";
import { readStdioConfiguration } from "./stdio-configuration.js";
import { verifyPages } from "./verification.js";

import type { DevicePairingRequest } from "./pairing-client.js";
import type { McpPairedCredential } from "../../definition/McpPairing.js";

/** Testable terminal boundaries; production defaults write exclusively to stderr. */
export interface CredentialCommandRuntime {
  readonly signal?: AbortSignal;
  readonly write?: (message: string) => void;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly openBrowser?: (link: URL) => Promise<boolean>;
}

interface CommandOptions {
  readonly command: "pair" | "rotate" | "unpair" | "status";
  readonly instance: URL;
  readonly name: string;
  readonly noBrowser: boolean;
}

interface PairingRuntime {
  readonly signal: AbortSignal;
  readonly write: (message: string) => void;
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly messages: ReturnType<typeof credentialMessages>;
}

function readOptions(
  argumentsList: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): CommandOptions {
  const command = argumentsList[0];
  if (
    command !== "pair" &&
    command !== "rotate" &&
    command !== "unpair" &&
    command !== "status"
  )
    throw new PairingClientError("wrong_instance");
  const { options, noBrowser } = readCommandFlags(argumentsList, command);
  let instance: URL;
  try {
    instance = readInstanceUrl(options.get("--url") ?? environment.PAGES_URL);
  } catch {
    throw new PairingClientError("wrong_instance");
  }
  const name = options.get("--name")?.trim() ?? "Pages MCP";
  if (!name || name.length > 100 || /[\p{Cc}\p{Cf}]/u.test(name))
    throw new PairingClientError("wrong_instance");
  return { command, instance, name, noBrowser };
}

function readCommandFlags(
  argumentsList: readonly string[],
  command: string,
): { options: Map<string, string>; noBrowser: boolean } {
  const options = new Map<string, string>();
  let noBrowser = false;
  for (let index = 1; index < argumentsList.length; index++) {
    const option = argumentsList[index];
    if (option === "--no-browser" && command === "pair" && !noBrowser) {
      noBrowser = true;
      continue;
    }
    if (
      (option !== "--url" && !(option === "--name" && command === "pair")) ||
      options.has(option) ||
      !argumentsList[index + 1]
    )
      throw new PairingClientError("wrong_instance");
    options.set(option, argumentsList[++index]);
  }
  return { options, noBrowser };
}

function reportFailure(error: unknown, runtime: PairingRuntime): number {
  if (runtime.signal.aborted) {
    runtime.write(runtime.messages.cancelled);
    return 130;
  }
  if (error instanceof CredentialStoreError) {
    runtime.write(error.message);
    return 1;
  }
  const code = error instanceof PairingClientError ? error.code : "failed";
  const outcomes = {
    access_denied: { message: runtime.messages.denied, exit: 2 },
    expired_token: { message: runtime.messages.expired, exit: 3 },
    wrong_instance: { message: runtime.messages.wrong, exit: 4 },
    invalid_grant: { message: runtime.messages.handoff, exit: 1 },
    handoff_failed: { message: runtime.messages.handoff, exit: 1 },
  };
  const outcome = Object.entries(outcomes).find(([key]) => key === code)?.[1];
  runtime.write(outcome?.message ?? runtime.messages.failed);
  return outcome?.exit ?? 1;
}

async function collect(
  client: PairingClient,
  request: DevicePairingRequest,
  runtime: PairingRuntime,
): Promise<McpPairedCredential> {
  let interval = request.interval * 1000;
  let networkFailures = 0;
  let nextNotice = Date.now() + 60_000;
  const deadline = request.expiresAt + 60_000;
  while (Date.now() < deadline) {
    await runtime.wait(interval, runtime.signal);
    if (runtime.signal.aborted) throw new PairingClientError("cancelled");
    if (Date.now() >= deadline) break;
    if (Date.now() >= nextNotice) {
      runtime.write(
        `${runtime.messages.remaining} ${Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000))}`,
      );
      nextNotice = Date.now() + 60_000;
    }
    try {
      return await client.exchange(request, runtime.signal);
    } catch (error: unknown) {
      if (!(error instanceof PairingClientError)) throw error;
      if (error.code === "authorization_pending") {
        networkFailures = 0;
        interval = request.interval * 1000;
        continue;
      }
      if (error.code === "slow_down") {
        request = { ...request, interval: request.interval + 5 };
        interval = Math.max(request.interval, error.retryAfter) * 1000;
        continue;
      }
      if (error.code !== "network" && error.code !== "temporarily_unavailable")
        throw error;
      interval = [5000, 10000, 20000, 30000][Math.min(networkFailures++, 3)];
      runtime.write(
        `${runtime.messages.network} ${interval / 1000} ${runtime.messages.seconds}`,
      );
    }
  }
  throw new PairingClientError("expired_token");
}

async function pair(
  options: CommandOptions,
  environment: Readonly<Record<string, string | undefined>>,
  runtime: PairingRuntime,
  openBrowser: (link: URL) => Promise<boolean>,
): Promise<void> {
  const client = new PairingClient(options.instance);
  const request = await client.begin(
    {
      clientName: options.name,
      device: hostname().slice(0, 100),
      packageVersion: manifest.version,
    },
    runtime.signal,
  );
  const link = instanceEndpoint(options.instance, "pair");
  link.searchParams.set("code", request.userCode);
  runtime.write(
    `${runtime.messages.heading} ${options.instance.href}\n\n  ${runtime.messages.link}: ${link.href}\n  ${runtime.messages.code}: ${request.userCode}\n\n${runtime.messages.instructions}\n${runtime.messages.expires}: ${new Date(request.expiresAt).toLocaleTimeString()}. ${runtime.messages.cancelHint}`,
  );
  const opened = await openBrowser(link);
  runtime.write(
    opened
      ? runtime.messages.opened
      : `${runtime.messages.fallback} ${instanceEndpoint(options.instance, "pair").href}`,
  );
  runtime.write(runtime.messages.waiting);
  try {
    const issued = await collect(client, request, runtime);
    const configuration = {
      agentsUrl: instanceEndpoint(options.instance, "api/v1/agents"),
      token: issued.token,
    };
    try {
      await verifyPages(configuration);
    } catch {
      throw new PairingClientError("handoff_failed");
    }
    const store = new CredentialStore(environment);
    const previous = await store.update(options.instance, async (current) => ({
      credential: {
        tokenId: issued.tokenId,
        token: issued.token,
        name: issued.name,
        expiresAt: issued.expiresAt,
        pairedAt: Date.now(),
      },
      result: current,
    }));
    if (previous) {
      try {
        await postAgentRequest(
          { ...configuration, token: previous.token },
          { operation: "credential.revoke", parameters: {} },
        );
      } catch {
        runtime.write(runtime.messages.offlineRemoved);
      }
    }
    runtime.write(
      `${runtime.messages.connected} ${issued.account.displayName} (${issued.account.username}). ${runtime.messages.saved}: ${issued.name}, ${runtime.messages.expires}: ${issued.expiresAt === null ? runtime.messages.unlimited : new Date(issued.expiresAt).toLocaleString()}.\n${runtime.messages.configuration}${options.instance.href}`,
    );
  } catch (error: unknown) {
    if (runtime.signal.aborted) {
      try {
        await client.cancel(request);
      } catch {
        runtime.write(runtime.messages.offlineRemoved);
      }
    }
    throw error;
  }
}

async function localCommand(
  options: CommandOptions,
  environment: Readonly<Record<string, string | undefined>>,
  runtime: PairingRuntime,
): Promise<void> {
  const store = new CredentialStore(environment);
  const credential = await store.get(options.instance);
  if (!credential) {
    runtime.write(runtime.messages.unpaired);
    throw new CredentialStoreError(runtime.messages.unpaired);
  }
  if (options.command === "unpair") {
    let revoked = false;
    try {
      await postAgentRequest(
        {
          agentsUrl: instanceEndpoint(options.instance, "api/v1/agents"),
          token: credential.token,
        },
        { operation: "credential.revoke", parameters: {} },
      );
      revoked = true;
    } catch {
      revoked = false;
    }
    await store.update(options.instance, async (current) => ({
      credential: current?.token === credential.token ? null : current,
      result: undefined,
    }));
    runtime.write(
      revoked ? runtime.messages.removed : runtime.messages.offlineRemoved,
    );
    return;
  }
  const configuration = await readStdioConfiguration({
    ...environment,
    PAGES_URL: options.instance.href,
    PAGES_TOKEN: undefined,
  });
  if (options.command === "rotate") {
    await configuration.credentials?.rotate(configuration.token);
    await verifyPages(configuration);
    runtime.write(runtime.messages.rotated);
    return;
  }
  const verified = await verifyPages(configuration);
  const current =
    verified.credential ?? (await store.get(options.instance)) ?? credential;
  runtime.write(
    `${runtime.messages.paired} ${options.instance.href}: ${current.name}, ${runtime.messages.expires}: ${current.expiresAt === null ? runtime.messages.unlimited : new Date(current.expiresAt).toLocaleString()}.`,
  );
}

/** Executes explicit pairing commands with stable exit codes and no stdout output. */
export async function runCredentialCommand(
  argumentsList: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  overrides: CredentialCommandRuntime = {},
): Promise<number> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const runtime: PairingRuntime = {
    signal: overrides.signal ?? controller.signal,
    write:
      overrides.write ?? ((message) => process.stderr.write(`${message}\n`)),
    wait:
      overrides.wait ??
      (async (milliseconds, signal) => {
        await delay(milliseconds, undefined, { signal });
      }),
    messages: credentialMessages(environment),
  };
  if (!overrides.signal) process.once("SIGINT", abort);
  try {
    const options = readOptions(argumentsList, environment);
    if (options.command === "pair")
      await pair(
        options,
        environment,
        runtime,
        overrides.openBrowser ??
          ((link) =>
            openPairingBrowser(link, environment, {
              noBrowser: options.noBrowser,
              isTerminal: Boolean(process.stderr.isTTY),
            })),
      );
    else await localCommand(options, environment, runtime);
    return 0;
  } catch (error: unknown) {
    return reportFailure(error, runtime);
  } finally {
    if (!overrides.signal) process.off("SIGINT", abort);
  }
}
