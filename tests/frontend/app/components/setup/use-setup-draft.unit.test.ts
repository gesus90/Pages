import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { useSetupDraft } from "@/app/components/setup/use-setup-draft";

import type { SetupDraft } from "@/app/components/setup/use-setup-draft";

it("uses new server suggestions until the database connection is edited", () => {
  const { result, rerender } = renderHook<SetupDraft, string | null>(
    useSetupDraft,
    {
      initialProps: null,
    },
  );
  expect(result.current.values.databaseUrl).toBe("");
  rerender("postgresql://localhost/suggested");
  expect(result.current.values.databaseUrl).toBe(
    "postgresql://localhost/suggested",
  );
  act(() =>
    result.current.setField("databaseUrl", "postgresql://localhost/chosen"),
  );
  rerender("postgresql://localhost/changed");
  expect(result.current.values.databaseUrl).toBe(
    "postgresql://localhost/chosen",
  );
  act(() => result.current.setField("databaseUrl", ""));
  rerender("postgresql://localhost/another");
  expect(result.current.values.databaseUrl).toBe("");
});

it("validates only the current step and preserves values when moving back", () => {
  const { result } = renderHook(() =>
    useSetupDraft("postgresql://localhost/pages"),
  );
  act(() => result.current.goBack());
  expect(result.current.stepIndex).toBe(0);
  act(() => result.current.goForward());
  expect(result.current.step).toBe("company");
  act(() => result.current.goForward());
  expect(result.current.step).toBe("company");
  expect(result.current.fieldErrors).toEqual({ companyName: "required" });
  act(() => result.current.setField("companyName", "Pages"));
  expect(result.current.fieldErrors).toEqual({});
  act(() => result.current.goForward());
  expect(result.current.step).toBe("administrator");
  act(() => result.current.goForward());
  expect(result.current.fieldErrors).toEqual({
    password: "required",
    username: "required",
  });
  act(() => {
    result.current.setField("username", "editor");
    result.current.setField("password", "synthetic-password");
    result.current.setField("email", "invalid");
  });
  act(() => result.current.goForward());
  expect(result.current.fieldErrors).toEqual({ email: "invalidEmail" });
  act(() => result.current.setField("email", "editor@example.test"));
  act(() => result.current.goForward());
  expect(result.current.step).toBe("database");
  act(() => result.current.goForward());
  expect(result.current.stepIndex).toBe(3);
  act(() => result.current.goBack());
  expect(result.current.values.username).toBe("editor");
  expect(result.current.values.companyName).toBe("Pages");
});

it("opens the first server-rejected step and clears only the edited error", () => {
  const { result } = renderHook(() => useSetupDraft(null));
  act(() =>
    result.current.showFieldErrors({
      companyName: "tooLong",
      username: "usernameTaken",
      databaseUrl: "required",
    }),
  );
  expect(result.current.step).toBe("company");
  act(() => result.current.setField("companyName", "Pages"));
  expect(result.current.fieldErrors).toEqual({
    username: "usernameTaken",
    databaseUrl: "required",
  });
  act(() => result.current.showFieldErrors({ email: "emailTaken" }));
  expect(result.current.step).toBe("administrator");
  act(() => result.current.showFieldErrors({ databaseUrl: "required" }));
  expect(result.current.step).toBe("database");
  act(() =>
    result.current.setField("databaseUrl", "postgresql://localhost/chosen"),
  );
  expect(result.current.fieldErrors).toEqual({});
  act(() => result.current.showFieldErrors({}));
  expect(result.current.step).toBe("welcome");
});
