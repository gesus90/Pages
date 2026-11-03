import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  readPicaBrowserOverview,
  readPicaBrowserView,
} from "@/definition/PicaBrowser";

import type {
  PicaBrowserCommand,
  PicaBrowserOverview,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

/** A failed request of the operator browser interface with the stable code the server sent. */
export class PicaBrowserClientError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = "PicaBrowserClientError";
    this.code = code;
  }
}

async function post(
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch("/chat-browser-api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new PicaBrowserClientError("NETWORK");
  }
  let answer: Record<string, unknown> = {};
  try {
    answer = readAgentObject(await response.json());
  } catch {
    throw new PicaBrowserClientError("BROWSER_FAILED");
  }
  if (!response.ok || answer.ok !== true)
    throw new PicaBrowserClientError(
      typeof answer.error === "string" ? answer.error : "BROWSER_FAILED",
    );
  return answer;
}

/** Reads the operator browsers and saved sessions of the signed-in administrator. */
export async function fetchPicaBrowsers(
  signal?: AbortSignal,
): Promise<PicaBrowserOverview> {
  const answer = await post({ intent: "overview" }, signal);
  const overview = readPicaBrowserOverview({
    browsers: answer.browsers,
    savedSessions: answer.savedSessions,
  });
  if (!overview) throw new PicaBrowserClientError("BROWSER_FAILED");
  return overview;
}

/** Sends a control of the administrator and returns the browser as it looks afterwards. */
export async function sendPicaBrowserCommand(
  browserId: string,
  command: PicaBrowserCommand,
): Promise<PicaBrowserView> {
  const answer = await post({ intent: "command", browserId, command });
  const view = readPicaBrowserView(answer.browser);
  if (!view) throw new PicaBrowserClientError("BROWSER_FAILED");
  return view;
}

/** The newest picture of a browser as an object URL, or `null` when none exists yet. */
export async function fetchPicaBrowserFrame(
  browserId: string,
  signal?: AbortSignal,
): Promise<{ readonly url: string; readonly version: number } | null> {
  const response = await fetch(
    `/chat/browser/${encodeURIComponent(browserId)}/frame`,
    { cache: "no-store", ...(signal ? { signal } : {}) },
  );
  if (response.status === 204) return null;
  if (!response.ok) throw new PicaBrowserClientError("BROWSER_FAILED");
  return {
    url: URL.createObjectURL(await response.blob()),
    version: Number(response.headers.get("X-Frame-Version") ?? "0"),
  };
}

/** The address with which an administrator downloads a file of their browser. */
export function picaBrowserDownloadUrl(
  browserId: string,
  downloadId: string,
): string {
  return `/chat/browser/${encodeURIComponent(browserId)}/downloads/${encodeURIComponent(downloadId)}`;
}
