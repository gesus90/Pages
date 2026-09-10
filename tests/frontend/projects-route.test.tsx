// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigate: vi.fn(),
    useNavigation: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";
import ProjectsRoute from "@/app/routes/projects";

import type { Project } from "@/definition/Project";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigate = vi.mocked(useNavigate);
const mockedNavigation = vi.mocked(useNavigation);

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(target: Element): void {
    const entry = {
      contentRect: target.getBoundingClientRect(),
      target,
    } as unknown as ResizeObserverEntry;

    this.callback([entry], this);
  }

  public unobserve(): void {}

  public disconnect(): void {}
}

function setViewportMetrics(
  element: HTMLElement,
  metrics: {
    readonly clientHeight: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
  },
): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
  });
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "New public website",
    hasIcon: false,
    id: "project-1",
    managerId: null,
    managerName: null,
    name: "Website refresh",
    notes: "",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 20,
    startDate: null,
    status: "active",
    targetDate: null,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

/** Reads the visible project card titles in their rendered order. */
function getCardTitles(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
}

function mockNavigation(entries: Record<string, string> | null = null): void {
  if (!entries) {
    mockedNavigation.mockReturnValue({ state: "idle" } as ReturnType<
      typeof useNavigation
    >);
    return;
  }

  const formData = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }

  mockedNavigation.mockReturnValue({
    formData,
    state: "submitting",
  } as unknown as ReturnType<typeof useNavigation>);
}

function renderProjects({
  actionData = undefined,
  canManageProjects = true,
  navigation = null,
  projects = [createProject()],
}: {
  readonly actionData?: unknown;
  readonly canManageProjects?: boolean;
  readonly navigation?: Record<string, string> | null;
  readonly projects?: readonly Project[];
} = {}): ReturnType<typeof render> {
  mockedLoaderData.mockReturnValue({
    canManageProjects,
    projects,
  });
  mockedActionData.mockReturnValue(actionData);
  mockNavigation(navigation);
  const navigate = vi.fn();
  mockedNavigate.mockReturnValue(navigate);
  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [
      { element: <ProjectsRoute />, path: "/projekte" },
      { element: <p>Projekt-Detailseite</p>, path: "/projekte/:projectId" },
    ],
    { initialEntries: ["/projekte"] },
  );

  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("ProjectsRoute", () => {
  it("renders project cards with placeholders and their current status", () => {
    renderProjects();

    expect(
      screen.getByRole("heading", { name: "Projekte" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Website refresh")).toBeInTheDocument();
    expect(screen.getByText("20 %")).toBeInTheDocument();
    expect(screen.getAllByText("Aktiv")).toHaveLength(2);
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Website refresh" }),
    ).toHaveAttribute("href", "/projekte/project-1");
  });

  it("navigates directly to the project page with a single click", async () => {
    const user = userEvent.setup();
    renderProjects();

    await user.click(screen.getByRole("link", { name: "Website refresh" }));

    expect(await screen.findByText("Projekt-Detailseite")).toBeInTheDocument();
  });

  it("uses stored project icons without a preview panel", () => {
    renderProjects({
      projects: [createProject({ description: "", hasIcon: true })],
    });

    const icons = document.querySelectorAll("img");

    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("src", "/projekte/project-1/icon");
    expect(
      screen.getByText("Keine Beschreibung hinterlegt."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Übersicht")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
  });

  it("hides management controls from project participants", () => {
    renderProjects({
      canManageProjects: false,
    });

    expect(
      screen.queryByRole("button", { name: "Neues Projekt" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Projekt-Icon")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
  });

  it("filters cards by status and search terms", async () => {
    const user = userEvent.setup();
    renderProjects({
      projects: [
        createProject(),
        createProject({
          description: "Pause work",
          id: "project-2",
          name: "Mobile app",
          status: "paused",
        }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Pausiert" }));
    expect(screen.queryByText("Website refresh")).not.toBeInTheDocument();
    expect(screen.getByText("Mobile app")).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Projekte suchen …"),
      "nothing",
    );
    expect(
      screen.getByText("Keine Projekte entsprechen diesem Filter."),
    ).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Projekte suchen …"));
    await user.type(screen.getByPlaceholderText("Projekte suchen …"), "pause");
    expect(screen.getByText("Mobile app")).toBeInTheDocument();
  });

  it("sorts cards alphabetically in both directions", async () => {
    const user = userEvent.setup();
    renderProjects({
      projects: [
        createProject({ id: "p1", name: "Charlie", updatedAt: "2026-01-01" }),
        createProject({ id: "p2", name: "Alpha", updatedAt: "2026-01-01" }),
        createProject({ id: "p3", name: "Beta", updatedAt: "2026-01-01" }),
      ],
    });

    const sortSelect = screen.getByRole("combobox", { name: "Sortierung" });

    await user.selectOptions(sortSelect, "nameAsc");
    expect(getCardTitles()).toEqual(["Alpha", "Beta", "Charlie"]);

    await user.selectOptions(sortSelect, "nameDesc");
    expect(getCardTitles()).toEqual(["Charlie", "Beta", "Alpha"]);
  });

  it("sorts cards by recency in both directions", async () => {
    const user = userEvent.setup();
    renderProjects({
      projects: [
        createProject({ id: "p1", name: "Oldest", updatedAt: "2026-01-01" }),
        createProject({ id: "p2", name: "Newest", updatedAt: "2026-03-01" }),
        createProject({ id: "p3", name: "Middle", updatedAt: "2026-02-01" }),
      ],
    });

    expect(getCardTitles()).toEqual(["Newest", "Middle", "Oldest"]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sortierung" }),
      "updatedAsc",
    );
    expect(getCardTitles()).toEqual(["Oldest", "Middle", "Newest"]);
  });

  it("sorts cards by status in both directions", async () => {
    const user = userEvent.setup();
    renderProjects({
      projects: [
        createProject({
          id: "p1",
          name: "Done",
          status: "completed",
          updatedAt: "2026-01-01",
        }),
        createProject({
          id: "p2",
          name: "Waiting",
          status: "paused",
          updatedAt: "2026-01-01",
        }),
        createProject({
          id: "p3",
          name: "Running",
          status: "active",
          updatedAt: "2026-01-01",
        }),
      ],
    });

    const sortSelect = screen.getByRole("combobox", { name: "Sortierung" });

    await user.selectOptions(sortSelect, "statusAsc");
    expect(getCardTitles()).toEqual(["Running", "Waiting", "Done"]);

    await user.selectOptions(sortSelect, "statusDesc");
    expect(getCardTitles()).toEqual(["Done", "Waiting", "Running"]);
  });

  it("shows the empty state and repeats the create control for managers", () => {
    renderProjects({ projects: [] });

    expect(screen.getByText("Noch keine Projekte")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Neues Projekt" }),
    ).toHaveLength(2);
  });

  it("renders planned and completed status dots and the manager name", () => {
    renderProjects({
      projects: [
        createProject({
          id: "p1",
          managerName: "Alex Berger",
          name: "Planned One",
          status: "planned",
        }),
        createProject({
          id: "p2",
          name: "Completed One",
          status: "completed",
        }),
      ],
    });

    const plannedCard = screen
      .getByText("Planned One")
      .closest("article") as HTMLElement;
    const completedCard = screen
      .getByText("Completed One")
      .closest("article") as HTMLElement;

    expect(plannedCard.querySelector(".size-2")?.className).toContain(
      "bg-primary",
    );
    expect(completedCard.querySelector(".size-2")?.className).toContain(
      "bg-slate-400",
    );
    expect(screen.getByText("Alex Berger")).toBeInTheDocument();
  });

  it("toggles the project grid scroll fades based on scroll position", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const { container } = renderProjects({
      projects: [
        createProject(),
        createProject({ id: "p2", name: "Second Project" }),
      ],
    });

    const viewport = container.querySelector(
      ".pages-hover-scrollbar",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
      return;
    }

    const topFade = container.querySelector(
      ".pages-scroll-fade-top",
    ) as HTMLElement | null;
    const bottomFade = container.querySelector(
      ".pages-scroll-fade-bottom",
    ) as HTMLElement | null;

    expect(topFade).not.toBeNull();
    expect(bottomFade).not.toBeNull();

    if (!topFade || !bottomFade) {
      return;
    }

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 0,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).toContain("opacity-0");
    expect(bottomFade.className).toContain("opacity-100");

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 400,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).toContain("opacity-100");
    expect(bottomFade.className).toContain("opacity-0");
  });
});

describe("project dialogs", () => {
  it("opens the create dialog and renders validation errors", async () => {
    const user = userEvent.setup();
    renderProjects({
      actionData: {
        error: "invalidInput",
        intent: "create-project",
        ok: false,
      },
    });

    await user.click(screen.getByRole("button", { name: "Neues Projekt" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name *")).toBeInTheDocument();
    expect(
      screen.getByText("Bitte überprüfe Name, Beschreibung und Fortschritt."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Projekt erstellen" }),
    ).not.toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(
      await screen.findByRole("option", { name: "Abgeschlossen" }),
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Abgeschlossen",
    );
  });

  it("disables the create dialog only for its own submission", async () => {
    const user = userEvent.setup();
    renderProjects({ navigation: { intent: "create-project" } });

    await user.click(screen.getByRole("button", { name: "Neues Projekt" }));

    expect(
      await screen.findByRole("button", { name: "Wird erstellt …" }),
    ).toBeDisabled();
  });

  it("navigates to successfully created projects", () => {
    renderProjects({
      actionData: {
        intent: "create-project",
        ok: true,
        projectId: "project 1",
      },
    });

    expect(mockedNavigate).toHaveBeenCalled();
    expect(mockedNavigate.mock.results[0]?.value).toHaveBeenCalledWith(
      "/projekte/project%201",
    );
  });
});
