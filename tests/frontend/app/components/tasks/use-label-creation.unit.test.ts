import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useLabelCreation } from "@/app/components/tasks/label-picker/use-label-creation";
import { DEFAULT_LABEL_COLOR } from "@/definition/Task";

import type { LabelCreationOptions } from "@/app/components/tasks/label-picker/use-label-creation";
import type { Label } from "@/definition/Task";

const submit = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({ useSubmit: () => submit }));
beforeEach(() => {
  submit.mockReset();
});

const oldLabel: Label = {
  id: "old",
  name: "Review",
  color: DEFAULT_LABEL_COLOR,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};
const initial: LabelCreationOptions = {
  workItemId: "ticket",
  labels: [oldLabel],
  assignedLabelIds: new Set(),
};

it("assigns only the newly created matching label after the catalog updates", () => {
  const { result, rerender } = renderHook(useLabelCreation, {
    initialProps: initial,
  });
  act(() => {
    result.current.startCreating();
    result.current.setNewName("  Review  ");
    result.current.setNewColor("#abcdef");
  });
  act(() => result.current.createLabel());
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    { intent: "label-create", name: "Review", color: "#abcdef" },
    { method: "post" },
  );
  expect(result.current.isCreating).toBe(true);
  rerender({
    ...initial,
    labels: [oldLabel, { ...oldLabel, id: "unrelated", name: "Other" }],
  });
  expect(submit).toHaveBeenCalledTimes(1);
  rerender({
    ...initial,
    labels: [oldLabel, { ...oldLabel, id: "new", name: "REVIEW" }],
  });
  expect(submit).toHaveBeenLastCalledWith(
    { intent: "label-assign", labelId: "new", workItemId: "ticket" },
    { method: "post" },
  );
  expect(result.current.isCreating).toBe(false);
  expect(result.current.newName).toBe("");
  expect(result.current.newColor).toBe(DEFAULT_LABEL_COLOR);
  rerender({ ...initial, labels: [oldLabel, { ...oldLabel, id: "new" }] });
  expect(submit).toHaveBeenCalledTimes(2);
});

it("does not assign a label that is already selected", () => {
  const { result, rerender } = renderHook(useLabelCreation, {
    initialProps: initial,
  });
  act(() => result.current.setNewName("Review"));
  act(() => result.current.createLabel());
  rerender({
    ...initial,
    labels: [{ ...oldLabel, id: "assigned" }],
    assignedLabelIds: new Set(["assigned"]),
  });
  expect(submit).toHaveBeenCalledTimes(1);
});

it("cancels pending assignment after rejection and keeps the editable draft", () => {
  const { result, rerender } = renderHook(useLabelCreation, {
    initialProps: initial,
  });
  act(() => {
    result.current.startCreating();
    result.current.setNewName("Review");
  });
  act(() => result.current.createLabel());
  act(() => result.current.cancelPendingAssign());
  rerender({ ...initial, labels: [{ ...oldLabel, id: "late" }] });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(result.current.isCreating).toBe(true);
  expect(result.current.newName).toBe("Review");
  act(() => result.current.closeForm());
  expect(result.current.isCreating).toBe(false);
  expect(result.current.newName).toBe("");
});
