import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InterpreterProfileRow } from "@/app/components/settings/system/interpreter-row";
import { useInterpreterProfiles } from "@/app/components/settings/system/use-interpreter-profiles";
import {
  requestInterpreterCheck,
  requestInterpreterSave,
} from "@/app/components/settings/system/interpreter-requests";

import type {
  InterpreterCheck,
  InterpreterSnapshot,
} from "@/definition/InterpreterProfile";
import type { InterpreterRow } from "@/app/components/settings/system/interpreter-editor-state";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/app/components/settings/system/interpreter-requests", () => ({
  requestInterpreterCheck: vi.fn(),
  requestInterpreterSave: vi.fn(),
}));

const snapshot: InterpreterSnapshot = {
  profiles: [
    { id: "one", name: "Python", path: "/python" },
    { id: "two", name: "Node", path: "/node" },
    { id: "three", name: "Ruby", path: "/ruby" },
  ],
  checks: {},
  revision: "rev-1",
};
const checked: InterpreterCheck = {
  path: "/new",
  status: "ok",
  version: "3.1",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("interpreter profiles", () => {
  it("checks a changed path before saving and adopts the confirmed snapshot", async () => {
    vi.mocked(requestInterpreterCheck).mockResolvedValue(checked);
    const saved = {
      ...snapshot,
      profiles: [
        { id: "one", name: "Python", path: "/new" },
        ...snapshot.profiles.slice(1),
      ],
      revision: "rev-2",
      checks: { one: checked },
    };
    vi.mocked(requestInterpreterSave).mockResolvedValue(saved);
    const { result } = renderHook(() => useInterpreterProfiles(snapshot));
    act(() => result.current.update("one", "path", "/new"));
    expect(result.current.canSave).toBe(false);
    await act(async () => result.current.checkProfile("one"));
    expect(result.current.canSave).toBe(true);
    await act(async () => result.current.save());
    expect(requestInterpreterSave).toHaveBeenCalledWith(
      saved.profiles,
      "rev-1",
    );
    expect(result.current.saved.revision).toBe("rev-2");
    expect(result.current.message).toBe("saved");
    expect(result.current.canSave).toBe(false);
  });

  it("ignores a late check after editing and retains a failed save response", async () => {
    let resolveCheck: (check: InterpreterCheck) => void = () => undefined;
    vi.mocked(requestInterpreterCheck).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const { result } = renderHook(() => useInterpreterProfiles(snapshot));
    act(() => result.current.update("one", "path", "/new"));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.checkProfile("one");
    });
    expect(result.current.rows[0]?.isChecking).toBe(true);
    act(() => result.current.update("one", "path", "/other"));
    await act(async () => {
      resolveCheck(checked);
      await pending;
    });
    expect(result.current.rows[0]?.check).toBeUndefined();
    vi.mocked(requestInterpreterCheck).mockResolvedValue({
      ...checked,
      path: "/other",
    });
    await act(async () => result.current.checkProfile("one"));
    vi.mocked(requestInterpreterSave).mockResolvedValue({
      error: "conflict",
      checks: {},
    });
    await act(async () => result.current.save());
    expect(result.current.message).toBe("conflict");
    expect(result.current.saved.revision).toBe("rev-1");
  });

  it("adds an incomplete row and restores the draft after a save exception", async () => {
    vi.mocked(requestInterpreterCheck).mockResolvedValue(checked);
    vi.mocked(requestInterpreterSave).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useInterpreterProfiles(snapshot));
    act(() => result.current.update("one", "path", "/new"));
    await act(async () => result.current.checkProfile("one"));
    await act(async () => result.current.save());
    expect(result.current.message).toBe("general");
    expect(result.current.rows[0]?.check).toEqual(checked);
    act(() => result.current.add());
    expect(result.current.rows).toHaveLength(4);
    expect(result.current.canSave).toBe(false);
    expect(result.current.message).toBe("");
  });
});

describe("interpreter row", () => {
  it("shows diagnostics and disables sync for duplicate names", () => {
    const row: InterpreterRow = {
      profile: { id: "one", name: "Python", path: "/python" },
      isChecking: false,
      check: {
        path: "/python",
        status: "error",
        version: null,
        error: "missing",
        diagnostic: "not found",
      },
    };
    const update = vi.fn();
    render(
      <table>
        <tbody>
          <InterpreterProfileRow
            row={row}
            savedPath="/python"
            isSaving={false}
            isDuplicate
            update={update}
            check={vi.fn()}
          />
        </tbody>
      </table>,
    );
    const path = screen.getByLabelText(
      "settings.system.interpreters.programPath",
    );
    expect(path.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/not found/u).textContent).toContain("missing");
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    fireEvent.change(
      screen.getByLabelText("settings.system.interpreters.profileName"),
      { target: { value: "New" } },
    );
    expect(update).toHaveBeenCalledWith("one", "name", "New");
  });

  it("debounces edits of saved paths and supports explicit sync", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(undefined);
    const row: InterpreterRow = {
      profile: { id: "one", name: "Python", path: "/python" },
      isChecking: false,
    };
    const view = render(
      <table>
        <tbody>
          <InterpreterProfileRow
            row={row}
            savedPath="/python"
            isSaving={false}
            isDuplicate={false}
            update={vi.fn()}
            check={check}
          />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(check).toHaveBeenCalledWith("one");
    view.rerender(
      <table>
        <tbody>
          <InterpreterProfileRow
            row={{ ...row, profile: { ...row.profile, path: "/new" } }}
            savedPath="/python"
            isSaving={false}
            isDuplicate={false}
            update={vi.fn()}
            check={check}
          />
        </tbody>
      </table>,
    );
    await act(async () => vi.advanceTimersByTime(350));
    expect(check).toHaveBeenCalledTimes(2);
  });
});
