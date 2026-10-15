import { act, renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { useConnectionsActions } from "@/app/components/settings/connections/use-connections-actions";
import { showSuccessToast } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

import type { PropsWithChildren } from "react";

interface ConnectionResult {
  readonly updated?: boolean;
  readonly error?: string;
}
const fetcher = vi.hoisted(() => ({
  data: undefined as ConnectionResult | undefined,
  state: "idle",
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
vi.mock("@/app/components/ui/toast", () => ({ showSuccessToast: vi.fn() }));
const i18n = createI18n("en");
function Wrapper({ children }: PropsWithChildren): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
  vi.mocked(showSuccessToast).mockReset();
});

it("requires selection and confirmation before submitting a revocation", () => {
  const { result } = renderHook(useConnectionsActions, { wrapper: Wrapper });
  act(() => result.current.confirm());
  expect(fetcher.submit).not.toHaveBeenCalled();
  act(() =>
    result.current.choose({
      intent: "revoke-token",
      id: "connection",
      name: "Editor",
    }),
  );
  expect(fetcher.submit).not.toHaveBeenCalled();
  act(() => result.current.confirm());
  const form: unknown = fetcher.submit.mock.calls[0]?.[0];
  expect(form).toBeInstanceOf(FormData);
  if (!(form instanceof FormData)) throw new Error("Expected connection form");
  expect(Object.fromEntries(form)).toEqual({
    intent: "revoke-token",
    id: "connection",
  });
  expect(fetcher.submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
});

it("retains the selected action on error and clears it after a successful retry", () => {
  const { result, rerender } = renderHook(useConnectionsActions, {
    wrapper: Wrapper,
  });
  act(() =>
    result.current.choose({ intent: "request-rotation", id: "connection" }),
  );
  act(() => result.current.confirm());
  fetcher.state = "submitting";
  rerender();
  expect(result.current.pending).toBe(true);
  fetcher.state = "idle";
  fetcher.data = { error: "access_denied" };
  rerender();
  expect(result.current.error).toBe("access_denied");
  expect(result.current.selected?.id).toBe("connection");
  expect(showSuccessToast).not.toHaveBeenCalled();
  act(() => result.current.confirm());
  expect(result.current.error).toBeUndefined();
  fetcher.state = "submitting";
  rerender();
  fetcher.state = "idle";
  fetcher.data = { updated: true };
  rerender();
  rerender();
  expect(result.current.selected).toBeNull();
  expect(result.current.pending).toBe(false);
  expect(showSuccessToast).toHaveBeenCalledExactlyOnceWith(
    i18n.t("settings.connections.rotate.success"),
  );
});

it("submits validity separately and ignores a previous successful response", () => {
  fetcher.data = { updated: true };
  const { result, rerender } = renderHook(useConnectionsActions, {
    wrapper: Wrapper,
  });
  expect(showSuccessToast).not.toHaveBeenCalled();
  act(() => result.current.validity("30"));
  const form: unknown = fetcher.submit.mock.calls[0]?.[0];
  if (!(form instanceof FormData)) throw new Error("Expected validity form");
  expect(Object.fromEntries(form)).toEqual({
    intent: "set-token-duration",
    days: "30",
  });
  fetcher.state = "loading";
  rerender();
  fetcher.state = "idle";
  fetcher.data = { updated: true };
  rerender();
  expect(showSuccessToast).toHaveBeenCalledExactlyOnceWith(
    i18n.t("settings.saved"),
  );
});

it("cancels a selection without submitting it", () => {
  const { result } = renderHook(useConnectionsActions, { wrapper: Wrapper });
  act(() =>
    result.current.choose({ intent: "revoke-token", id: "connection" }),
  );
  act(() => result.current.cancel());
  expect(result.current.selected).toBeNull();
  expect(fetcher.submit).not.toHaveBeenCalled();
});
