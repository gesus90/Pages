import { act, render } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

import { PhaseMilestonePlan } from "@/app/components/projects/phase-milestone-plan";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { Milestone, MilestoneDependency } from "@/definition/Task";

/** A stand-in for a react-router fetcher whose answer the test controls. */
export interface FakeFetcher {
  state: "idle" | "submitting";
  data: unknown;
  submit: ReturnType<typeof vi.fn>;
}

/** Creates a fetcher that is idle, has no answer and records submissions. */
export function createFakeFetcher(): FakeFetcher {
  return { data: undefined, state: "idle", submit: vi.fn() };
}

interface PlanProps {
  readonly milestones: readonly Milestone[];
  readonly milestoneLinks: readonly MilestoneDependency[];
  readonly canWrite: boolean;
}

/** Handle on a rendered plan. */
export interface RenderedPlan {
  /** Changes props and renders again, as a loader revalidation would. */
  readonly setProps: (next: Partial<PlanProps>) => void;
  /** Renders again, for example after changing a fake fetcher. */
  readonly refresh: () => void;
}

/** Renders the milestone plan in a router; a rendering context for hooks. */
export function renderPlan(initial: Partial<PlanProps> = {}): RenderedPlan {
  let current: PlanProps = {
    canWrite: true,
    milestoneLinks: [],
    milestones: [],
    ...initial,
  };
  let force: () => void = () => {};

  function Harness(): React.ReactElement {
    const [, setCount] = useState(0);

    force = () => setCount((count) => count + 1);

    return <PhaseMilestonePlan {...current} />;
  }

  const router = createMemoryRouter([{ element: <Harness />, path: "/" }], {
    initialEntries: ["/"],
  });

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return {
    refresh: () => act(() => force()),
    setProps: (next) => {
      current = { ...current, ...next };
      act(() => force());
    },
  };
}

const scrollPositions = new WeakMap<Element, number>();

/**
 * Gives elements a size, because jsdom lays nothing out.
 *
 * @param clientWidth - Width of every element's visible area.
 * @param scrollWidth - Width of every element's content.
 * @returns A function that removes the sizes again.
 */
export function installLayout(
  clientWidth: number,
  scrollWidth: number,
): () => void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get(this: Element) {
      return scrollPositions.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      scrollPositions.set(this, value);
    },
  });

  return () => {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollLeft");
  };
}
