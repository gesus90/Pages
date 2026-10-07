// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  RegionProvider,
  useRegionFormatter,
} from "@/app/components/common/region-provider";

import type { RegionPreferences } from "@/app/components/common/region-provider";

function Sample(): React.ReactElement {
  const { formatDate, formatDateTime } = useRegionFormatter();

  return (
    <p>
      {formatDate("2026-09-30")} | {formatDateTime("2026-09-30 22:30:00")}
    </p>
  );
}

function renderWith(region: RegionPreferences | null): void {
  render(
    region ? (
      <RegionProvider region={region}>
        <Sample />
      </RegionProvider>
    ) : (
      <Sample />
    ),
  );
}

describe("useRegionFormatter", () => {
  it("applies the chosen date format and time zone", () => {
    renderWith({ dateFormat: "YYYY-MM-DD", timezone: "Asia/Tokyo" });

    expect(screen.getByText("2026-09-30 | 2026-10-01 07:30")).toBeVisible();
  });

  it("uses the German format and the time zone of the browser by default", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      timeZone: "Europe/Berlin",
    } as Intl.ResolvedDateTimeFormatOptions);

    renderWith(null);

    expect(screen.getByText("30.09.2026 | 01.10.2026 00:30")).toBeVisible();
  });

  it("renders UTC on the server, which does not know the browser's zone", () => {
    const html = renderToString(
      <RegionProvider region={{ dateFormat: "DD.MM.YYYY", timezone: null }}>
        <Sample />
      </RegionProvider>,
    );

    expect(html).toContain("30.09.2026 22:30");
  });
});
