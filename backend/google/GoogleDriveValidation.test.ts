import { describe, expect, it, vi } from "vitest";

import {
  findMissingGoogleDriveSettings,
  readGoogleOAuthApplication,
} from "./GoogleDriveConfig";
import { DRIVE_FOLDER_MIME_TYPE, isGoogleAppsType } from "./GoogleDriveFormats";
import {
  listGoogleDriveOrigins,
  pickGoogleDriveOrigin,
} from "./GoogleDriveOrigins";
import {
  driveProblem,
  isRecord,
  readErrorReasons,
  readJson,
  readString,
  sendGoogleRequest,
} from "./GoogleDriveResponses";

import type { GoogleFetch } from "./GoogleDriveResponses";

describe("Google Drive configuration", () => {
  it("accepts complete credentials and reports malformed settings by name", () => {
    const environment = {
      PAGES_GOOGLE_DRIVE_CLIENT_ID: " client.apps.googleusercontent.com ",
      PAGES_GOOGLE_DRIVE_CLIENT_SECRET: " secret ",
    };
    expect(readGoogleOAuthApplication(environment)).toEqual({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
    });
    expect(findMissingGoogleDriveSettings(environment)).toEqual([]);
    expect(readGoogleOAuthApplication({})).toBeNull();
    expect(
      findMissingGoogleDriveSettings({
        PAGES_GOOGLE_DRIVE_CLIENT_ID: "bad",
        PAGES_GOOGLE_DRIVE_CLIENT_SECRET: "has space",
      }),
    ).toEqual([
      "PAGES_GOOGLE_DRIVE_CLIENT_ID",
      "PAGES_GOOGLE_DRIVE_CLIENT_SECRET",
    ]);
  });

  it("restricts origins to loopback and the configured HTTPS origin", () => {
    const origins = listGoogleDriveOrigins(
      { port: 3000, publicUrl: "https://pages.example/path" },
      {},
    );
    expect(origins).toEqual(["http://127.0.0.1:3000", "https://pages.example"]);
    expect(pickGoogleDriveOrigin("https://pages.example", origins)).toBe(
      "https://pages.example",
    );
    expect(pickGoogleDriveOrigin("http://localhost:3000", origins)).toBeNull();
    expect(
      listGoogleDriveOrigins(
        { port: 3000 },
        { PAGES_PUBLIC_URL: "http://example.com" },
      ),
    ).toEqual(["http://127.0.0.1:3000"]);
  });

  it("recognizes Google document types but not folders", () => {
    expect(isGoogleAppsType("application/vnd.google-apps.document")).toBe(true);
    expect(isGoogleAppsType(DRIVE_FOLDER_MIME_TYPE)).toBe(false);
    expect(isGoogleAppsType("text/plain")).toBe(false);
  });
});

describe("Google Drive responses", () => {
  it("extracts error reasons and translates known failures", () => {
    const body = {
      error: { errors: [{ reason: "insufficientScopes" }, null, {}] },
    };
    expect(readErrorReasons(body)).toEqual(["insufficientScopes", "", ""]);
    expect(readErrorReasons({ error: {} })).toEqual([]);
    expect(readErrorReasons(null)).toEqual([]);
    expect(driveProblem(401, null)).toBe("access_revoked");
    expect(
      driveProblem(403, {
        error: { errors: [{ reason: "accessNotConfigured" }] },
      }),
    ).toBe("drive_api_disabled");
    expect(driveProblem(403, body)).toBe("scope_missing");
    expect(driveProblem(500, null)).toBe("google_unreachable");
    expect(isRecord([])).toBe(false);
    expect(readString({ count: 1 }, "count")).toBe("");
  });

  it("reads JSON and sends requests with redirect protection and a timeout", async () => {
    expect(await readJson(new Response('{"ok":true}'))).toEqual({ ok: true });
    const fetcher = vi.fn<GoogleFetch>(async () => new Response("ok"));
    const response = await sendGoogleRequest(
      fetcher,
      "https://example.com",
      { method: "POST" },
      1000,
    );
    expect(await response?.text()).toBe("ok");
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe("https://example.com");
    expect(request?.[1].method).toBe("POST");
    expect(request?.[1].redirect).toBe("error");
    expect(request?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});

it("returns no remote origin for missing or malformed configuration", () => {
  expect(listGoogleDriveOrigins({ port: 3000 }, {})).toEqual([
    "http://127.0.0.1:3000",
  ]);
  expect(
    listGoogleDriveOrigins({ port: 3000, publicUrl: "invalid" }, {}),
  ).toEqual(["http://127.0.0.1:3000"]);
});

it("handles malformed responses and network failures", async () => {
  expect(await readJson(new Response("invalid json"))).toBeNull();
  const fetcher = vi.fn<GoogleFetch>(async () => {
    throw new Error("network unavailable");
  });
  expect(
    await sendGoogleRequest(fetcher, "https://example.com", {}),
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
});
