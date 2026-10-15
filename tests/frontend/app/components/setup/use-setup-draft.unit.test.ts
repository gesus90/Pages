import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { useSetupDraft } from "@/app/components/setup/use-setup-draft";

import type { SetupDraft } from "@/app/components/setup/use-setup-draft";

it("uses new server suggestions until the database path is edited", () => {
  const { result, rerender } = renderHook<SetupDraft, string | null>(
    useSetupDraft,
    {
      initialProps: null,
    },
  );
  expect(result.current.values.databasePath).toBe("");
  rerender("/suggested.duckdb");
  expect(result.current.values.databasePath).toBe("/suggested.duckdb");
  act(() => result.current.setField("databasePath", "/chosen.duckdb"));
  rerender("/changed.duckdb");
  expect(result.current.values.databasePath).toBe("/chosen.duckdb");
  act(() => result.current.setField("databasePath", ""));
  rerender("/another.duckdb");
  expect(result.current.values.databasePath).toBe("");
});

it("validates only the current step and preserves values when moving back", () => {
  const { result } = renderHook(() => useSetupDraft("/pages.duckdb"));
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
      databasePath: "required",
    }),
  );
  expect(result.current.step).toBe("company");
  act(() => result.current.setField("companyName", "Pages"));
  expect(result.current.fieldErrors).toEqual({
    username: "usernameTaken",
    databasePath: "required",
  });
  act(() => result.current.showFieldErrors({ email: "emailTaken" }));
  expect(result.current.step).toBe("administrator");
  act(() => result.current.showFieldErrors({ databasePath: "required" }));
  expect(result.current.step).toBe("database");
  act(() => result.current.setField("databasePath", "/chosen.duckdb"));
  expect(result.current.fieldErrors).toEqual({});
  act(() => result.current.showFieldErrors({}));
  expect(result.current.step).toBe("welcome");
});
