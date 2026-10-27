import { afterEach, describe, expect, it, vi } from "vitest";

import { data } from "react-router";

import { createPagesRequestListener } from "@/backend/runtime/PagesServer";
import { serveStaticAsset } from "@/backend/runtime/StaticAssets";

import { SERVER_BUILD } from "./pages-server-fixture";
import { createStaticExchange } from "./static-asset-exchange";

import type { ServerBuild } from "react-router";

vi.mock("@/backend/runtime/StaticAssets", () => ({
  serveStaticAsset: vi.fn(async () => false),
}));
// The executable plan catalog of the independent MCP package stays out of Pages tests.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
// Without an initialized log file, every request start is mirrored to stderr.
vi.mock("@/backend/logging/LogFallback", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  writeLogFallback: vi.fn(),
}));

const PUBLIC_HOST = "pages.example.test:1080";
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;
const PROXY_ADDRESS = "192.0.2.10";
const BAD_REQUEST = 400;

interface UnusableProtocolHeader {
  readonly forwardedProto: string;
  readonly protocolHeader: Readonly<Record<string, string>>;
}

const UNUSABLE_PROTOCOL_HEADERS: readonly UnusableProtocolHeader[] = [
  { forwardedProto: "is missing", protocolHeader: {} },
  {
    forwardedProto: "says http",
    protocolHeader: { "x-forwarded-proto": "http" },
  },
  {
    forwardedProto: "is not a protocol",
    protocolHeader: { "x-forwarded-proto": "javascript" },
  },
];

const loginAction = vi.fn(async () => data({ error: "invalid" }, 401));

/** A build whose only route is a login action, so reaching it is observable. */
const LOGIN_BUILD: ServerBuild = {
  ...SERVER_BUILD,
  assets: {
    ...SERVER_BUILD.assets,
    routes: {
      login: {
        clientActionModule: undefined,
        clientLoaderModule: undefined,
        clientMiddlewareModule: undefined,
        hasAction: true,
        hasClientAction: false,
        hasClientLoader: false,
        hasClientMiddleware: false,
        hasErrorBoundary: false,
        hasLoader: false,
        hydrateFallbackModule: undefined,
        id: "login",
        imports: [],
        module: "/assets/login.js",
        path: "login",
      },
    },
  },
  routes: {
    login: {
      id: "login",
      module: { action: loginAction, default: () => null },
      path: "login",
    },
  },
};

interface LoginPost {
  /** TCP peer that opens the connection. */
  readonly peer: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly trustedProxies?: readonly string[];
}

/** Sends the browser's login POST to the listener and returns the status. */
async function postLogin(post: LoginPost): Promise<number | null> {
  const listener = createPagesRequestListener(
    LOGIN_BUILD,
    "/srv/client",
    post.trustedProxies,
  );
  const exchange = createStaticExchange("POST", "/login.data");
  Object.defineProperty(exchange.request.socket, "remoteAddress", {
    value: post.peer,
  });
  exchange.request.headers = {
    "content-type": "application/x-www-form-urlencoded",
    host: PUBLIC_HOST,
    ...post.headers,
  };
  exchange.request.push(null);

  listener(exchange.request, exchange.response);
  await exchange.finished;

  return exchange.status();
}

afterEach(() => {
  loginAction.mockClear();
  vi.mocked(serveStaticAsset).mockClear();
});

describe("a login POST that a reverse proxy forwards from HTTPS", () => {
  const forwardedFromHttps = {
    origin: PUBLIC_ORIGIN,
    "x-forwarded-proto": "https",
  };

  it("reaches the action when the proxy is trusted", async () => {
    const status = await postLogin({
      headers: forwardedFromHttps,
      peer: PROXY_ADDRESS,
      trustedProxies: [PROXY_ADDRESS],
    });

    expect(status).not.toBe(BAD_REQUEST);
    expect(loginAction).toHaveBeenCalledTimes(1);
  });

  it("reaches the action when the trusted proxy is a range and the peer an IPv4-mapped address", async () => {
    const status = await postLogin({
      headers: forwardedFromHttps,
      peer: `::ffff:${PROXY_ADDRESS}`,
      trustedProxies: ["192.0.2.0/24"],
    });

    expect(status).not.toBe(BAD_REQUEST);
    expect(loginAction).toHaveBeenCalledTimes(1);
  });

  it("is refused while no proxy is configured", async () => {
    const status = await postLogin({
      headers: forwardedFromHttps,
      peer: PROXY_ADDRESS,
    });

    expect(status).toBe(BAD_REQUEST);
    expect(loginAction).not.toHaveBeenCalled();
  });

  it("is refused when it comes from an address that is not a trusted proxy", async () => {
    const status = await postLogin({
      headers: forwardedFromHttps,
      peer: "198.51.100.7",
      trustedProxies: [PROXY_ADDRESS],
    });

    expect(status).toBe(BAD_REQUEST);
    expect(loginAction).not.toHaveBeenCalled();
  });

  it.each(UNUSABLE_PROTOCOL_HEADERS)(
    "is refused from a trusted proxy when X-Forwarded-Proto $forwardedProto",
    async ({ protocolHeader }) => {
      const status = await postLogin({
        headers: { origin: PUBLIC_ORIGIN, ...protocolHeader },
        peer: PROXY_ADDRESS,
        trustedProxies: [PROXY_ADDRESS],
      });

      expect(status).toBe(BAD_REQUEST);
      expect(loginAction).not.toHaveBeenCalled();
    },
  );

  it("keeps the origin check for a trusted proxy", async () => {
    const status = await postLogin({
      headers: {
        origin: "https://attacker.example.test",
        "x-forwarded-proto": "https",
      },
      peer: PROXY_ADDRESS,
      trustedProxies: [PROXY_ADDRESS],
    });

    expect(status).toBe(BAD_REQUEST);
    expect(loginAction).not.toHaveBeenCalled();
  });

  it("keeps the origin check when the host or the port differs", async () => {
    const status = await postLogin({
      headers: {
        origin: "https://pages.example.test:8443",
        "x-forwarded-proto": "https",
      },
      peer: PROXY_ADDRESS,
      trustedProxies: [PROXY_ADDRESS],
    });

    expect(status).toBe(BAD_REQUEST);
    expect(loginAction).not.toHaveBeenCalled();
  });
});

describe("a login POST that reaches Pages directly over HTTP", () => {
  it("reaches the action when the origin is the address of the request", async () => {
    const status = await postLogin({
      headers: { origin: `http://${PUBLIC_HOST}` },
      peer: "198.51.100.7",
    });

    expect(status).not.toBe(BAD_REQUEST);
    expect(loginAction).toHaveBeenCalledTimes(1);
  });

  it("is refused for a foreign origin", async () => {
    const status = await postLogin({
      headers: { origin: "http://attacker.example.test" },
      peer: "198.51.100.7",
    });

    expect(status).toBe(BAD_REQUEST);
    expect(loginAction).not.toHaveBeenCalled();
  });

  it("is refused for an HTTPS origin, whatever the client claims", async () => {
    const status = await postLogin({
      headers: { origin: PUBLIC_ORIGIN, "x-forwarded-proto": "https" },
      peer: "198.51.100.7",
      trustedProxies: [PROXY_ADDRESS],
    });

    expect(status).toBe(BAD_REQUEST);
    expect(loginAction).not.toHaveBeenCalled();
  });
});
