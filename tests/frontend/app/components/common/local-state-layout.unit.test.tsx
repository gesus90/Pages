import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import {
  createLocalStateLayoutAnswers,
  useLocalStateLayoutAnswer,
} from "@/app/components/common/use-local-state-layout";

it("shares a refresh only with views of the answer it replaces", () => {
  const answers = createLocalStateLayoutAnswers<{ owner: string }>();
  const loaded = { owner: "first" };
  const other = { owner: "second" };
  const { result, rerender, unmount } = renderHook(
    ({ current }) => useLocalStateLayoutAnswer(current, { answers }),
    { initialProps: { current: loaded } },
  );
  expect(result.current).toBe(loaded);
  const refreshed = { owner: "updated" };
  act(() => answers.replace({ of: loaded, answer: refreshed }));
  expect(result.current).toBe(refreshed);
  rerender({ current: other });
  expect(result.current).toBe(other);
  unmount();
  expect(answers.current()?.answer).toBe(refreshed);
});
