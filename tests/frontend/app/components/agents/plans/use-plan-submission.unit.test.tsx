import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import {
  actionScene,
  planPage,
  planView,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { PlanActionScene, PlanEditor } from "./plan-panel-fixture";

function held(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function SaveControls({
  editor,
}: {
  readonly editor: PlanEditor;
}): React.ReactElement {
  return (
    <>
      <button
        type="button"
        onClick={() =>
          editor.saveWith((draft) => ({ ...draft, name: "First" }))
        }
      >
        Save first
      </button>
      <button
        type="button"
        onClick={() =>
          editor.saveWith((draft) => ({ ...draft, name: "Second" }))
        }
      >
        Save second
      </button>
      <output aria-label="State">
        {JSON.stringify({
          name: editor.draft.name,
          revision: editor.draft.revision,
          isDirty: editor.isDirty,
          isSaving: editor.isSaving,
          isPending: editor.isPending,
          command: editor.command.state,
        })}
      </output>
    </>
  );
}

function stateOf(): Record<string, unknown> {
  return JSON.parse(screen.getByLabelText("State").textContent ?? "{}");
}

function planOf(form: FormData): { name: string; revision: number } {
  return JSON.parse(String(form.get("plan")));
}

function scene(answers: PlanActionScene["answers"]): PlanActionScene {
  return { ...actionScene(), answers };
}

it("sends a save asked for during a running save after the first answer, with the stored revision", async () => {
  const hold = held();
  const saves = scene([
    { ok: true, intent: "save-plan", revision: 4 },
    { ok: true, intent: "save-plan", revision: 5 },
  ]);
  saves.hold = hold.promise;
  renderWithEditor(
    planPage({ selected: planView({ revision: 3 }) }),
    saves,
    (editor) => <SaveControls editor={editor} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Save first" }));
  await waitFor(() => expect(saves.submissions).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Save second" }));
  expect(saves.submissions).toHaveLength(1);

  act(() => hold.release());
  await waitFor(() => expect(saves.submissions).toHaveLength(2));

  expect(planOf(saves.submissions[0])).toMatchObject({
    name: "First",
    revision: 3,
  });
  expect(planOf(saves.submissions[1])).toMatchObject({
    name: "Second",
    revision: 4,
  });
  await waitFor(() =>
    expect(stateOf()).toMatchObject({
      revision: 5,
      isDirty: false,
      isSaving: false,
    }),
  );
});

it("drops the waiting save when the running one is refused", async () => {
  const hold = held();
  const saves = scene([
    { ok: false, intent: "save-plan", error: "plan_conflict" },
  ]);
  saves.hold = hold.promise;
  renderWithEditor(
    planPage({ selected: planView({ revision: 3 }) }),
    saves,
    (editor) => <SaveControls editor={editor} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Save first" }));
  await waitFor(() => expect(saves.submissions).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Save second" }));
  act(() => hold.release());

  await waitFor(() => expect(stateOf()).toMatchObject({ isSaving: false }));
  expect(saves.submissions).toHaveLength(1);
  // The refused draft is still unsaved and keeps the later edit.
  expect(stateOf()).toMatchObject({
    name: "Second",
    revision: 3,
    isDirty: true,
  });
});

it("sends nothing more when the waiting save adds nothing to the stored one", async () => {
  const hold = held();
  const saves = scene([{ ok: true, intent: "save-plan", revision: 4 }]);
  saves.hold = hold.promise;
  renderWithEditor(
    planPage({ selected: planView({ revision: 3 }) }),
    saves,
    (editor) => <SaveControls editor={editor} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Save first" }));
  await waitFor(() => expect(saves.submissions).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Save first" }));
  act(() => hold.release());

  await waitFor(() =>
    expect(stateOf()).toMatchObject({
      revision: 4,
      isDirty: false,
      isSaving: false,
    }),
  );
  expect(saves.submissions).toHaveLength(1);
});

it("keeps edits made while the save runs unsaved on top of the stored revision", async () => {
  const hold = held();
  const saves = scene([{ ok: true, intent: "save-plan", revision: 4 }]);
  saves.hold = hold.promise;
  renderWithEditor(
    planPage({ selected: planView({ revision: 3 }) }),
    saves,
    (editor) => (
      <>
        <SaveControls editor={editor} />
        <button type="button" onClick={() => editor.rename("Edited meanwhile")}>
          Edit meanwhile
        </button>
      </>
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "Save first" }));
  await waitFor(() => expect(stateOf()).toMatchObject({ isSaving: true }));
  fireEvent.click(screen.getByRole("button", { name: "Edit meanwhile" }));
  act(() => hold.release());

  await waitFor(() =>
    expect(stateOf()).toMatchObject({
      name: "Edited meanwhile",
      revision: 4,
      isDirty: true,
      isSaving: false,
    }),
  );
});

it("counts a save as answered before the page data reload ends", async () => {
  const reload = held();
  const saves = {
    ...scene([{ ok: true, intent: "save-plan", revision: 4 }]),
    hasLoader: true,
  };
  renderWithEditor(
    planPage({ selected: planView({ revision: 3 }) }),
    saves,
    (editor) => <SaveControls editor={editor} />,
  );
  await waitFor(() => expect(stateOf()).toMatchObject({ command: "idle" }));

  saves.reload = reload.promise;
  fireEvent.click(screen.getByRole("button", { name: "Save first" }));

  // The answer is in while the reload is held: the plan is stored, nothing is saving and the editor is free.
  await waitFor(() =>
    expect(stateOf()).toMatchObject({
      command: "loading",
      revision: 4,
      isDirty: false,
      isSaving: false,
      isPending: false,
    }),
  );
  act(() => reload.release());
  await waitFor(() => expect(stateOf()).toMatchObject({ command: "idle" }));
});
