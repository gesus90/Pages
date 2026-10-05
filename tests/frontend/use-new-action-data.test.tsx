// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useNewActionData } from "@/app/components/setup/use-new-action-data";

describe("useNewActionData", () => {
  it("handles every new result once and ignores a reset", () => {
    const handle = vi.fn();
    const { rerender } = renderHook(
      ({ result }: { result: { value: number } | undefined }) =>
        useNewActionData(result, handle),
      {
        initialProps: {
          result: undefined as { value: number } | undefined,
        },
      },
    );
    const first = { value: 1 };

    rerender({ result: first });
    rerender({ result: first });
    rerender({ result: undefined });
    rerender({ result: { value: 2 } });

    expect(handle.mock.calls).toEqual([[{ value: 1 }], [{ value: 2 }]]);
  });
});
