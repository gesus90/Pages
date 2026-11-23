import { describe, expect, it, vi } from "vitest";

import { pinLocalSessionTools } from "@/backend/agents/local/LocalSessionTools";
import { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import { AgentToolUpdateSearch } from "@/backend/service/agents/tools/AgentToolUpdateSearch";

function createTools(): AgentToolManagerService {
  return new AgentToolManagerService({
    files: {
      root: "/tools",
      home: vi.fn(),
      current: vi.fn(),
      candidate: vi.fn(),
      activate: vi.fn(),
      previous: vi.fn(),
      discard: vi.fn(),
      remove: vi.fn(),
      readEnabled: vi.fn(),
      writeEnabled: vi.fn(),
    },
    installer: { install: vi.fn() },
    health: { check: vi.fn() },
    updates: AgentToolUpdateSearch.prototype,
    system: vi.fn(),
  });
}

describe("pinLocalSessionTools", () => {
  it("reserves node, bubblewrap and the provider tools", () => {
    const tools = createTools();
    const reserve = vi.spyOn(tools.supervisor, "reserve");
    pinLocalSessionTools(tools, {
      instanceId: "instance",
      provider: "codex_cli",
      browser: false,
    });
    expect(reserve).toHaveBeenCalledOnce();
    const [id, reserved] = reserve.mock.calls[0] ?? ["", []];
    expect(id).toBe("instance");
    expect([...reserved].sort()).toEqual(
      ["bubblewrap", "codex", "codex_acp", "node"].sort(),
    );
  });

  it("adds the browser tools and their dependencies for a browser session", () => {
    const tools = createTools();
    const reserve = vi.spyOn(tools.supervisor, "reserve");
    pinLocalSessionTools(tools, {
      instanceId: "instance",
      provider: "opencode",
      browser: true,
    });
    expect(reserve.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "node",
        "bubblewrap",
        "opencode",
        "playwright_mcp",
        "chromium",
      ]),
    );
  });
});
