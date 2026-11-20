import { describe, expect, it } from "vitest";

import {
  RUNNER_CHANNEL_PATH,
  consoleScopeOf,
  isConversationWebChannel,
  isRemoteConsoleChannel,
  isRunnerChannel,
} from "./ChannelPaths";

const ID = "0b3f1c52-7a4e-4d0e-9a55-3c1d2e4f5a66";
const MALFORMED_TARGET = "http://";

describe("consoleScopeOf", () => {
  it("resolves the workspace console path", () => {
    expect(consoleScopeOf(`/agents/workspaces/${ID}/console/socket`)).toEqual({
      kind: "workspace",
      id: ID,
    });
  });

  it("resolves the connection console path", () => {
    expect(
      consoleScopeOf(
        `/agents/workspaces/remote/connections/${ID}/console/socket`,
      ),
    ).toEqual({ kind: "connection", id: ID });
  });

  it("resolves the connection setup path", () => {
    expect(
      consoleScopeOf(
        `/agents/workspaces/remote/connections/${ID}/setup/socket`,
      ),
    ).toEqual({ kind: "setup", id: ID });
  });

  it.each([
    "/",
    "/agents/workspaces/not-a-uuid/console/socket",
    `/agents/workspaces/${ID.toUpperCase()}/console/socket`,
    `/agents/workspaces/${ID}/console/socket/extra`,
    `/prefix/agents/workspaces/${ID}/console/socket`,
  ])("returns null for %s", (pathname) => {
    expect(consoleScopeOf(pathname)).toBeNull();
  });
});

describe("isRemoteConsoleChannel", () => {
  it("accepts a console path and ignores the query", () => {
    expect(
      isRemoteConsoleChannel(
        `/agents/workspaces/${ID}/console/socket?sessionId=${ID}&after=3`,
      ),
    ).toBe(true);
  });

  it("rejects other paths", () => {
    expect(isRemoteConsoleChannel("/runner/v1/channel/x")).toBe(false);
  });

  it("treats a missing target as the root path", () => {
    expect(isRemoteConsoleChannel(undefined)).toBe(false);
  });

  it("returns false instead of throwing for a malformed target", () => {
    expect(isRemoteConsoleChannel(MALFORMED_TARGET)).toBe(false);
  });
});

describe("isRunnerChannel", () => {
  it("accepts the runner path with a connection id", () => {
    expect(isRunnerChannel(`/runner/v1/channel/${ID}`)).toBe(true);
    expect(RUNNER_CHANNEL_PATH.exec(`/runner/v1/channel/${ID}`)?.[1]).toBe(ID);
  });

  it("rejects a query string because the whole target is matched", () => {
    expect(isRunnerChannel(`/runner/v1/channel/${ID}?x=1`)).toBe(false);
  });

  it("rejects a missing target and a short id", () => {
    expect(isRunnerChannel(undefined)).toBe(false);
    expect(isRunnerChannel("/runner/v1/channel/abc")).toBe(false);
  });
});

describe("isConversationWebChannel", () => {
  it("accepts the chat socket path with a query", () => {
    expect(isConversationWebChannel("/chat/conversations/socket?x=1")).toBe(
      true,
    );
  });

  it("rejects other paths and a missing target", () => {
    expect(isConversationWebChannel("/chat/conversations")).toBe(false);
    expect(isConversationWebChannel(undefined)).toBe(false);
  });

  it("returns false for a malformed target", () => {
    expect(isConversationWebChannel(MALFORMED_TARGET)).toBe(false);
  });
});
