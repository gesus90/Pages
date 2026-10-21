import { checkServerConnection } from "@/api/health";
import { PagesClient } from "@/api/pages-client";

function clientAnswering(answer: () => Promise<Response>): PagesClient {
  return new PagesClient({
    baseUrl: "https://pages.example.com",
    fetchImplementation: answer,
  });
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe("checkServerConnection", () => {
  it.each([
    [{ status: "ok" }, 200, "connected"],
    [{ status: "setup" }, 200, "setupPending"],
    [{ status: "unavailable" }, 503, "serverError"],
  ] as const)(
    "reads %j with status %i as %s",
    async (body, status, expected) => {
      const client = clientAnswering(() => json(body, status));

      await expect(checkServerConnection(client)).resolves.toBe(expected);
    },
  );

  it("reports a server that is not Pages", async () => {
    await expect(
      checkServerConnection(clientAnswering(() => json({ status: "fine" }))),
    ).resolves.toBe("notPages");
    await expect(
      checkServerConnection(clientAnswering(() => json({}, 404))),
    ).resolves.toBe("notPages");
    await expect(
      checkServerConnection(
        clientAnswering(() => Promise.resolve(new Response("<html>"))),
      ),
    ).resolves.toBe("notPages");
  });

  it("reports a gateway error as a server error", async () => {
    await expect(
      checkServerConnection(clientAnswering(() => json({}, 502))),
    ).resolves.toBe("serverError");
  });

  it("reports an unreachable server", async () => {
    const client = clientAnswering(() =>
      Promise.reject(new TypeError("Network request failed")),
    );

    await expect(checkServerConnection(client)).resolves.toBe("unreachable");
  });

  it("lets a programming error through instead of hiding it", async () => {
    const client = new PagesClient({
      baseUrl: "https://pages.example.com",
      auth: {
        getAuthorizationHeader: () => Promise.reject(new Error("broken")),
      },
    });

    await expect(checkServerConnection(client)).rejects.toThrow("broken");
  });
});
