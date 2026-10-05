import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:react-router/server-build", () => ({ routes: {} }));

vi.mock("@/backend/runtime/PagesServer", () => ({
  startPagesServer: vi.fn(),
}));

import { startPagesServer } from "@/backend/runtime/PagesServer";
import { startServer } from "@/backend/runtime/ServerEntry";

describe("startServer", () => {
  it("starts the production server with the build it belongs to", async () => {
    vi.mocked(startPagesServer).mockResolvedValue(0);

    await expect(startServer(["--port", "4000"])).resolves.toBe(0);

    expect(startPagesServer).toHaveBeenCalledWith({
      argumentList: ["--port", "4000"],
      build: expect.objectContaining({ routes: {} }),
      clientDirectory: fileURLToPath(
        new URL("../../backend/client", import.meta.url),
      ),
    });
  });
});
