import { expect, it, vi } from "vitest";

import {
  buildGoogleAuthorizationUrl,
  GoogleDriveApiClient,
} from "./GoogleDriveApiClient";
import { GOOGLE_DRIVE_REQUESTED_SCOPES } from "./GoogleDriveConfig";

const application = { clientId: "client", clientSecret: "secret" };
const input = {
  code: "code",
  redirectUri: "https://example.test/callback",
  codeVerifier: "verifier",
};

it("builds consent URLs with scoped write access and PKCE", () => {
  const base = {
    clientId: "client",
    redirectUri: input.redirectUri,
    state: "state",
    codeChallenge: "challenge",
  };
  const read = new URL(buildGoogleAuthorizationUrl(base));
  const write = new URL(
    buildGoogleAuthorizationUrl({ ...base, isWriteConsent: true }),
  );
  expect(read.searchParams.get("include_granted_scopes")).toBe("false");
  expect(write.searchParams.get("include_granted_scopes")).toBe("true");
  expect(write.searchParams.get("scope")).toBe(
    GOOGLE_DRIVE_REQUESTED_SCOPES.join(" "),
  );
  expect(read.searchParams.get("scope")).toBe(
    GOOGLE_DRIVE_REQUESTED_SCOPES.join(" "),
  );
  expect(read.searchParams.get("code_challenge_method")).toBe("S256");
  expect(read.searchParams.get("state")).toBe("state");
});

it("exchanges and refreshes tokens with a deterministic clock", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 60,
        scope: "one two",
      }),
    ),
  );
  const client = new GoogleDriveApiClient(application, {
    fetcher,
    now: () => 1000,
  });
  await expect(client.exchangeCode(input)).resolves.toEqual({
    ok: true,
    value: {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 61000,
      grantedScopes: ["one", "two"],
    },
  });
  expect(fetcher.mock.calls[0]?.[1].body).toContain("code_verifier=verifier");
  await client.refresh("refresh");
  expect(fetcher.mock.calls[1]?.[1].body).toContain("grant_type=refresh_token");
});

it.each([
  [400, { error: "invalid_grant" }, "access_revoked"],
  [400, { error: "invalid_client" }, "client_invalid"],
  [400, { error: "unauthorized_client" }, "client_invalid"],
  [500, {}, "google_unreachable"],
  [429, {}, "google_unreachable"],
  [400, {}, "client_invalid"],
  [400, null, "client_invalid"],
])("classifies token response %s %o", async (status, body, problem) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const client = new GoogleDriveApiClient(application, { fetcher });
  await expect(client.refresh("refresh")).resolves.toEqual({
    ok: false,
    problem,
  });
});

it.each([
  null,
  {},
  { access_token: "token", expires_in: 0 },
  { access_token: "token", expires_in: "bad" },
])("rejects malformed grants %o", async (body) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  const client = new GoogleDriveApiClient(application, { fetcher });
  await expect(client.refresh("refresh")).resolves.toEqual({
    ok: false,
    problem: "google_unreachable",
  });
});

it("reads an account and handles missing data and failed requests", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: { permissionId: "id", emailAddress: "a@example.test" },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { permissionId: "id" } })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: {} })))
    .mockResolvedValueOnce(new Response(JSON.stringify({})))
    .mockResolvedValueOnce(new Response("{}", { status: 401 }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"));
  const client = new GoogleDriveApiClient(application, { fetcher });
  await expect(client.readAccount("token")).resolves.toEqual({
    ok: true,
    value: { permissionId: "id", emailAddress: "a@example.test" },
  });
  await expect(client.readAccount("token")).resolves.toEqual({
    ok: true,
    value: { permissionId: "id", emailAddress: null },
  });
  await expect(client.readAccount("token")).resolves.toEqual({
    ok: false,
    problem: "google_unreachable",
  });
  await expect(client.readAccount("token")).resolves.toEqual({
    ok: false,
    problem: "google_unreachable",
  });
  await expect(client.readAccount("token")).resolves.toMatchObject({
    ok: false,
  });
  await expect(client.readAccount("token")).resolves.toEqual({
    ok: false,
    problem: "google_unreachable",
  });
  await expect(client.refresh("token")).resolves.toEqual({
    ok: false,
    problem: "google_unreachable",
  });
});

it("uses the default fetch and accepts a grant without optional fields", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ access_token: "token", expires_in: 1 })),
    );
  vi.stubGlobal("fetch", fetcher);
  try {
    const client = new GoogleDriveApiClient(application, { now: () => 0 });
    await expect(client.refresh("refresh")).resolves.toEqual({
      ok: true,
      value: {
        accessToken: "token",
        expiresAt: 1000,
        refreshToken: null,
        grantedScopes: [],
      },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
