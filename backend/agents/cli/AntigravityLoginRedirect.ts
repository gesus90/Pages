import { timingSafeEqual } from "node:crypto";
import { request } from "node:http";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliLoopbackCallback } from "./CliContracts";

const MAX_ADDRESS_LENGTH = 4096;
const DELIVERY_TIMEOUT_MS = 10_000;

function hasSingleValue(parameters: URLSearchParams, name: string): boolean {
  const values = parameters.getAll(name);
  return values.length === 1 && values[0].length > 0;
}

function isSameState(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseAddress(address: string): URL {
  const trimmed = address.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_ADDRESS_LENGTH ||
    /[\s\p{Cc}]/u.test(trimmed)
  )
    throw new AgentError("login_callback_invalid");
  // A copied address bar can omit the scheme; only the query is delivered.
  const absolute = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    return new URL(absolute);
  } catch {
    throw new AgentError("login_callback_invalid");
  }
}

/**
 * Validates the address Google redirected a browser to after consent.
 *
 * @param address - The full address the user copied from the browser.
 * @param expected - The listener and `state` of this one login operation.
 * @returns The unchanged query to deliver to that listener.
 * @throws {AgentError} `login_callback_invalid` unless the address names this
 * login's loopback port and `state` and carries a code or a provider error.
 *
 * @remarks
 * The redirect target stays Google's registered loopback URI; Pages neither
 * rewrites it nor redeems the code. The query is never logged or returned.
 */
export function readAntigravityRedirect(
  address: string,
  expected: CliLoopbackCallback,
): string {
  const url = parseAddress(address);
  const parameters = url.searchParams;
  const state = parameters.get("state") ?? "";
  if (
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== expected.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.hash ||
    !hasSingleValue(parameters, "state") ||
    !isSameState(state, expected.state) ||
    parameters.getAll("code").length > 1 ||
    parameters.getAll("error").length > 1 ||
    (!hasSingleValue(parameters, "code") &&
      !hasSingleValue(parameters, "error"))
  )
    throw new AgentError("login_callback_invalid");
  return url.search.slice(1);
}

/**
 * Hands the redirect once to the adapter's own listener on this host.
 *
 * @param callback - The listener the adapter announced for this login.
 * @param query - A query accepted by {@link readAntigravityRedirect}.
 * @param signal - Ends the delivery together with the login.
 * @throws {AgentError} `login_callback_unreachable` when the listener is gone.
 *
 * @remarks
 * The target is fixed to `127.0.0.1` and the announced port, so no client value
 * can choose a host; redirects are not followed and the answer is discarded.
 * The adapter itself checks `state` and exchanges the code with its PKCE verifier.
 */
export async function deliverAntigravityRedirect(
  callback: CliLoopbackCallback,
  query: string,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port: callback.port,
        path: `/?${query}`,
        method: "GET",
        agent: false,
        signal,
        timeout: DELIVERY_TIMEOUT_MS,
        headers: { Connection: "close" },
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 400) resolve();
        else reject(new AgentError("login_callback_unreachable"));
      },
    );
    outgoing.on("timeout", () => outgoing.destroy());
    // The native error names the target; only the stable code leaves here.
    outgoing.on("error", () =>
      reject(new AgentError("login_callback_unreachable")),
    );
    outgoing.end();
  });
}
