import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { isIP } from "node:net";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError } from "@/backend/logging/Logger";
import { PICA_MOBILE_PATH } from "@/definition/PicaMobile";
import {
  PAGES_CORE_CONTRACT_VERSION,
  PAGES_CORE_RELAY_HEADERS,
} from "@/definition/PagesCoreContract";

import type { IncomingMessage } from "node:http";
import type { PicaMobilePortError } from "@/definition/PicaMobile";

/** Query parameter of a probe that runs through `pages-core` to the relay listener. */
const PROBE_PARAMETER = "relayProbe";
const PROBE_TIMEOUT_MILLISECONDS = 1_000;
/** `pages-core` looks at the configuration every second. */
const PORT_WAIT_MILLISECONDS = 5_000;
const PORT_WAIT_STEP_MILLISECONDS = 250;

/** What the relay listener of the API is set up with. */
export interface PicaMobileRelayOptions {
  /** `pagesCoreSecret`, which `pages-core` proves itself with. */
  readonly secret: string;
  /** The loopback port of the relay listener, `picaMobileRelayPort`. */
  readonly port: number;
}

function headerText(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];

  return typeof value === "string" ? value : null;
}

/** The address a probe reaches the core's Pica Mobile port at. */
function probeHost(listenAddress: string | undefined): string {
  if (
    listenAddress === undefined ||
    listenAddress === "0.0.0.0" ||
    listenAddress === "::"
  ) {
    return "127.0.0.1";
  }

  return listenAddress;
}

function sendProbe(host: string, port: number, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = httpRequest(
      {
        // A fresh connection: a pooled one may still lead to a listener the core already closed.
        agent: false,
        host,
        port,
        path: `${PICA_MOBILE_PATH}?${PROBE_PARAMETER}=${token}`,
        timeout: PROBE_TIMEOUT_MILLISECONDS,
      },
      (answer) => {
        answer.resume();
        answer.on("end", resolve);
        answer.on("error", reject);
      },
    );

    probe.on("timeout", () => probe.destroy(new Error("Probe timeout")));
    probe.on("error", reject);
    probe.end();
  });
}

function classifyBindError(error: unknown): PicaMobilePortError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;

  if (code === "EADDRINUSE") {
    return "portInUse";
  }

  return code === "EACCES" ? "permissionDenied" : "listenFailed";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The API's side of the Pica Mobile relay of `pages-core` (PAGE-239).
 *
 * @remarks
 * While `picaMobileRelayPort` is set, `pages-core` holds the app's port and
 * relays every connection and attachment request to the API's relay listener
 * on that loopback port. The listener admits only requests that carry the
 * shared secret, contract version 1 and the app's address; it decides
 * everything else exactly as on its own port. Whether the core serves a
 * port is proven end to end: a probe with a one-time token goes to the port
 * and counts only when it arrives at this listener through the core.
 */
export class PicaMobileRelay {
  /** The loopback port of the relay listener. */
  public readonly port: number;
  private readonly expectedSecret: Buffer;
  private readonly probes = new Map<string, boolean>();
  private readonly changes = new SerialQueue();

  /**
   * Creates the relay side.
   *
   * @param options - Secret and relay port.
   */
  public constructor(options: PicaMobileRelayOptions) {
    this.port = options.port;
    this.expectedSecret = Buffer.from(`Bearer ${options.secret}`);
  }

  /**
   * Runs port changes one after another, as the gateway does without the core.
   *
   * @param change - Checks, stores and confirms one port.
   * @returns What the change returns.
   */
  public serialize<T>(change: () => Promise<T>): Promise<T> {
    return this.changes.run(change);
  }

  /**
   * Admits a request that `pages-core` relayed.
   *
   * @param request - Upgrade or attachment request on the relay listener.
   * @returns The app's address, or `null` when the request does not carry
   * the secret, the contract version and a valid address.
   */
  public admit(request: IncomingMessage): string | null {
    const received = Buffer.from(
      headerText(request, PAGES_CORE_RELAY_HEADERS.secret) ?? "",
    );

    if (
      received.length !== this.expectedSecret.length ||
      !timingSafeEqual(received, this.expectedSecret) ||
      headerText(request, PAGES_CORE_RELAY_HEADERS.contract) !==
        String(PAGES_CORE_CONTRACT_VERSION)
    ) {
      return null;
    }

    const client = headerText(request, PAGES_CORE_RELAY_HEADERS.client);

    return client !== null && isIP(client) !== 0 ? client : null;
  }

  /**
   * Records an admitted probe of {@link PicaMobileRelay.confirm}.
   *
   * @param requestUrl - The request target.
   * @returns `true` when the request is an open probe, which is answered
   * with `204`; any other request, also one with an unknown token, is not.
   */
  public receiveProbe(requestUrl: string | undefined): boolean {
    if (!URL.canParse(requestUrl ?? "/", "http://relay.invalid")) {
      return false;
    }

    const url = new URL(requestUrl ?? "/", "http://relay.invalid");
    const token = url.searchParams.get(PROBE_PARAMETER);

    if (url.pathname !== PICA_MOBILE_PATH || !token || !this.probes.has(token))
      return false;

    this.probes.set(token, true);

    return true;
  }

  /**
   * Tells whether `pages-core` serves a port and relays it to this listener.
   *
   * @param listenAddress - `listenAddress` of the configuration.
   * @param port - The app's port.
   */
  public async confirm(
    listenAddress: string | undefined,
    port: number,
  ): Promise<boolean> {
    const token = randomBytes(16).toString("hex");

    this.probes.set(token, false);

    try {
      await sendProbe(probeHost(listenAddress), port, token);

      return this.probes.get(token) === true;
    } catch (error: unknown) {
      logCaughtError("PicaMobileRelay", error);

      return false;
    } finally {
      this.probes.delete(token);
    }
  }

  /**
   * Waits until `pages-core` serves a port it found in the configuration.
   *
   * @param listenAddress - `listenAddress` of the configuration.
   * @param port - The app's port.
   * @returns `false` when the core did not serve it within five seconds.
   */
  public async awaitPort(
    listenAddress: string | undefined,
    port: number,
  ): Promise<boolean> {
    const deadline = Date.now() + PORT_WAIT_MILLISECONDS;

    while (Date.now() < deadline) {
      if (await this.confirm(listenAddress, port)) {
        return true;
      }

      await delay(PORT_WAIT_STEP_MILLISECONDS);
    }

    return false;
  }

  /**
   * Tells whether a port can be bound now, as the core will bind it.
   *
   * @param listenAddress - `listenAddress` of the configuration.
   * @param port - The app's port.
   * @returns Why it cannot be bound, or `null` when it can.
   */
  public checkPort(
    listenAddress: string | undefined,
    port: number,
  ): Promise<PicaMobilePortError | null> {
    return new Promise((resolve) => {
      const server = createServer();

      server.once("error", (error) => {
        logCaughtError("PicaMobileRelay", error);
        resolve(classifyBindError(error));
      });
      server.listen(port, listenAddress, () => {
        server.close(() => resolve(null));
      });
    });
  }
}
