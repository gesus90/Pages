import { describe, expect, it } from "vitest";

import { isStorageFolderNavigation } from "@/app/lib/storage-folder-navigation";

import type { ShouldRevalidateFunctionArgs } from "react-router";

function navigation(
  from: string,
  to: string,
  extra: Partial<ShouldRevalidateFunctionArgs> = {},
): ShouldRevalidateFunctionArgs {
  const args: ShouldRevalidateFunctionArgs = {
    currentUrl: new URL(from, "https://pages.example"),
    currentParams: {},
    nextUrl: new URL(to, "https://pages.example"),
    nextParams: {},
    defaultShouldRevalidate: true,
    ...extra,
  };
  return args;
}

describe("isStorageFolderNavigation", () => {
  it("recognizes a change of folder inside Storage", () => {
    expect(
      isStorageFolderNavigation(
        navigation("/storage?folder=a", "/storage?folder=b"),
      ),
    ).toBe(true);
  });

  it("recognizes entering and leaving a folder from the root", () => {
    expect(
      isStorageFolderNavigation(navigation("/storage", "/storage?folder=a")),
    ).toBe(true);
    expect(
      isStorageFolderNavigation(navigation("/storage?folder=a", "/storage")),
    ).toBe(true);
  });

  it("keeps other equal parameters out of the decision", () => {
    expect(
      isStorageFolderNavigation(
        navigation(
          "/storage?folder=a&view=grid",
          "/storage?folder=b&view=grid",
        ),
      ),
    ).toBe(true);
  });

  it("reads the frame again when another parameter changes with the folder", () => {
    expect(
      isStorageFolderNavigation(
        navigation(
          "/storage?folder=a&view=grid",
          "/storage?folder=b&view=list",
        ),
      ),
    ).toBe(false);
  });

  it("reads the frame again for the same folder", () => {
    expect(
      isStorageFolderNavigation(
        navigation("/storage?folder=a", "/storage?folder=a"),
      ),
    ).toBe(false);
  });

  it("reads the frame again after a form submission or an action result", () => {
    const from = "/storage?folder=a";
    const to = "/storage?folder=b";

    expect(
      isStorageFolderNavigation(navigation(from, to, { formMethod: "POST" })),
    ).toBe(false);
    expect(
      isStorageFolderNavigation(navigation(from, to, { actionResult: {} })),
    ).toBe(false);
  });

  it("reads the frame again when either side is outside Storage", () => {
    expect(
      isStorageFolderNavigation(
        navigation("/storage?folder=a", "/projects?folder=b"),
      ),
    ).toBe(false);
    expect(
      isStorageFolderNavigation(
        navigation("/projects?folder=a", "/storage?folder=b"),
      ),
    ).toBe(false);
  });
});
