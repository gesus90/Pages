import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

import { useServerConnection } from "@/connection/use-server-connection";

import type { AppStateStatus } from "react-native";

function healthResponse(status: string, httpStatus = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ status }), { status: httpStatus }),
  );
}

describe("useServerConnection", () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let emitAppState: (state: AppStateStatus) => void;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch");
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((type, listener) => {
        emitAppState = listener;

        return { remove: jest.fn() };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks the health endpoint of the configured server", async () => {
    fetchMock.mockImplementation(() => healthResponse("ok"));

    const { result } = renderHook(() =>
      useServerConnection("https://pages.example.com", true),
    );

    expect(result.current.status).toBe("checking");
    expect(result.current.host).toBe("pages.example.com");

    await waitFor(() => expect(result.current.status).toBe("connected"));

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://pages.example.com/health",
    );
    expect(result.current.checkedAt).toBeInstanceOf(Date);
  });

  it("does not ask anything while no server is configured", () => {
    const { result } = renderHook(() => useServerConnection(null, true));

    expect(result.current.status).toBe("unconfigured");
    expect(result.current.host).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports offline without a request and checks again when the network returns", async () => {
    fetchMock.mockImplementation(() => healthResponse("ok"));

    const { result, rerender } = renderHook(
      ({ isOnline }: { isOnline: boolean }) =>
        useServerConnection("https://pages.example.com", isOnline),
      { initialProps: { isOnline: false } },
    );

    expect(result.current.status).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ isOnline: true });

    await waitFor(() => expect(result.current.status).toBe("connected"));
  });

  it("reports an unreachable server", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    const { result } = renderHook(() =>
      useServerConnection("https://pages.example.com", true),
    );

    await waitFor(() => expect(result.current.status).toBe("unreachable"));
  });

  it("checks again on request and when the app returns to the foreground", async () => {
    fetchMock.mockImplementation(() => healthResponse("setup"));

    const { result } = renderHook(() =>
      useServerConnection("https://pages.example.com", true),
    );

    await waitFor(() => expect(result.current.status).toBe("setupPending"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => result.current.recheck());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    act(() => emitAppState("background"));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => emitAppState("active"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("ignores an answer that arrives after the address changed", async () => {
    const answers: ((response: Response) => void)[] = [];

    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => answers.push(resolve)),
    );

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useServerConnection(url, true),
      { initialProps: { url: "https://old.example.com" } },
    );

    rerender({ url: "https://new.example.com" });
    await waitFor(() => expect(answers).toHaveLength(2));

    await act(async () => {
      answers[1]?.(new Response(JSON.stringify({ status: "setup" })));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.status).toBe("setupPending"));

    await act(async () => {
      answers[0]?.(new Response(JSON.stringify({ status: "ok" })));
      await Promise.resolve();
    });

    expect(result.current.status).toBe("setupPending");
    expect(result.current.host).toBe("new.example.com");
  });
});
