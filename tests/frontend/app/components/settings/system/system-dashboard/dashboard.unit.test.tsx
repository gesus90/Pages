import { render, renderHook, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { DiskPanel } from "@/app/components/settings/system/system-dashboard/disk-panel";
import { EMPTY_HISTORY } from "@/app/components/settings/system/system-dashboard/load-history";
import { LoadSparkline } from "@/app/components/settings/system/system-dashboard/load-sparkline";
import { LoadTiles } from "@/app/components/settings/system/system-dashboard/load-tiles";
import { ServicePanel } from "@/app/components/settings/system/system-dashboard/service-panel";
import { useDashboardFormat } from "@/app/components/settings/system/system-dashboard/use-dashboard-format";
import { createI18n } from "@/app/lib/i18n";

import type { SystemDashboard } from "@/definition/SystemDashboard";
import type { ReactNode } from "react";

const GIB = 1024 ** 3;
const MEASUREMENT: SystemDashboard = {
  measuredAt: 1000,
  processor: { usage: 0.5, load: 1.25, cores: 4, temperature: 71 },
  memory: { total: 8 * GIB, available: 2 * GIB },
  swap: { total: GIB, used: GIB / 2, isSwapping: true },
  agents: { active: 2, maximum: 4, memory: 1024 },
  disks: [],
  facts: {
    version: "1",
    build: null,
    nodeVersion: "22",
    pagesStartedAt: 0,
    serverStartedAt: null,
    databaseSize: null,
    dataDirectorySize: null,
    tools: null,
  },
};

function Wrapper({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("en")}>
      <RegionProvider region={{ dateFormat: "DD.MM.YYYY", timezone: "UTC" }}>
        {children}
      </RegionProvider>
    </I18nextProvider>
  );
}

describe("dashboard formatting", () => {
  it("formats missing values, sizes, percentages and elapsed time", () => {
    const { result } = renderHook(() => useDashboardFormat(), {
      wrapper: Wrapper,
    });
    const format = result.current;
    expect(format.percent(null)).toBe("—");
    expect(format.percent(0.456)).toBe("46%");
    expect(format.bytes(null)).toBe("—");
    expect(format.bytes(-10)).toBe("0 B");
    expect(format.bytes(1536)).toBe("1.5 KB");
    expect(format.gigabytes(2 * GIB)).toBe("2.0");
    expect(format.usage(GIB, 2 * GIB)).toBe("1.0 of 2.0 GB");
    expect(format.usage(1024, GIB)).toBe("1.0 KB of 1.0 GB");
    expect(format.duration(null, 0)).toBe("—");
    expect(format.duration(1000, 0)).toBe("< 1 min");
    expect(format.duration(0, 120_000)).toBe("2 min");
    expect(format.duration(0, 3_900_000)).toBe("1 h 5 min");
    expect(format.duration(0, 90_000_000)).toBe("1 d 1 h");
    expect(format.celsius(71)).toContain("71");
  });

  it("uses the selected region for today, yesterday and older dates", () => {
    const { result } = renderHook(() => useDashboardFormat(), {
      wrapper: Wrapper,
    });
    const now = Date.UTC(2026, 0, 3, 12);
    expect(result.current.day(null, now)).toBe("—");
    expect(result.current.day(Date.UTC(2026, 0, 3, 9, 30), now)).toContain(
      "today",
    );
    expect(result.current.day(Date.UTC(2026, 0, 2, 9, 30), now)).toContain(
      "yesterday",
    );
    expect(result.current.day(Date.UTC(2026, 0, 1), now)).toBe("01.01.2026");
  });
});

describe("dashboard panels", () => {
  it("shows waiting tiles and measured resource details, omitting absent swap", () => {
    const view = render(
      <LoadTiles dashboard={null} history={EMPTY_HISTORY} end={null} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("Swap")).toBeTruthy();
    view.rerender(
      <LoadTiles dashboard={MEASUREMENT} history={EMPTY_HISTORY} end={1000} />,
    );
    expect(screen.getByText("Load 1.25 · 4 cores")).toBeTruthy();
    expect(screen.getByText("6.0 of 8.0 GB")).toBeTruthy();
    expect(screen.getByText("swapping")).toBeTruthy();
    expect(screen.getByText("of 4 ACP instances")).toBeTruthy();
    view.rerender(
      <LoadTiles
        dashboard={{
          ...MEASUREMENT,
          swap: null,
          memory: null,
          agents: { active: 1, maximum: 0, memory: null },
          processor: {
            ...MEASUREMENT.processor,
            load: null,
            temperature: null,
          },
        }}
        history={EMPTY_HISTORY}
        end={1000}
      />,
    );
    expect(screen.queryByText("Swap")).toBeNull();
    expect(screen.getByText("4 cores")).toBeTruthy();
    expect(screen.getByText("no upper limit")).toBeTruthy();
  });

  it("shows reachable and unreachable disks", () => {
    render(
      <DiskPanel
        disks={[
          { mountPoint: "/", isReachable: true, size: 100, used: 60, free: 20 },
          { mountPoint: "/mnt/archive/", isReachable: false },
        ]}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText("2 mounted")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("20 B free")).toBeTruthy();
    expect(screen.getByText("archive")).toBeTruthy();
    expect(screen.getByText("Not reachable")).toBeTruthy();
  });
});

describe("service and history panels", () => {
  it("shows service state, memory limits and running time", () => {
    const view = render(<ServicePanel reading={null} now={120_000} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByRole("table")).toBeNull();
    view.rerender(
      <ServicePanel
        now={120_000}
        reading={{
          kind: "granted",
          details: {
            version: 1,
            light: "yellow",
            services: [
              {
                name: "pages-api.service",
                state: "active",
                lastStart: 0,
                restarts: 2,
                memoryCurrent: 1024,
                memoryLimit: 2048,
              },
              {
                name: "custom.service",
                state: "failed",
                lastStart: 0,
                restarts: 3,
                memoryCurrent: 512,
                memoryLimit: null,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("1 of 2 running")).toBeTruthy();
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("API and interface")).toBeTruthy();
    expect(within(rows[1]).getByText("1.0 KB / 2.0 KB")).toBeTruthy();
    expect(within(rows[1]).getByText("2 min")).toBeTruthy();
    expect(within(rows[2]).getByText("custom")).toBeTruthy();
    expect(within(rows[2]).getByText("512 B · no limit")).toBeTruthy();
  });

  it("draws connected readings and breaks for missing or distant samples", () => {
    const view = render(<LoadSparkline samples={[]} end={null} />, {
      wrapper: Wrapper,
    });
    expect(view.container.querySelector("path")).toBeNull();
    view.rerender(
      <LoadSparkline
        end={600_000}
        samples={[
          { at: 0, ratio: 0 },
          { at: 2000, ratio: 1 },
          { at: 3000, ratio: null },
          { at: 4000, ratio: 0.5 },
          { at: 12000, ratio: 0.25 },
        ]}
      />,
    );
    expect(view.container.querySelector("path")?.getAttribute("d")).toBe(
      "M0.00 41.00 L0.00 41.00 L0.67 3.00 M1.33 22.00 L1.33 22.00 M4.00 31.50 L4.00 31.50",
    );
    expect(view.container.querySelectorAll("stop")).toHaveLength(8);
  });
});
