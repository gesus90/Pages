import { expect, test } from "../support/fixtures";

import type { Locator, Page, TestInfo } from "@playwright/test";

/** The design with a painting behind the content and the plain default. */
const KOI_GARDEN = "koi-garden";
const STANDARD = "standard";

/** How far the settings scroll so the section heading sticks at the top. */
const SCROLL_DISTANCE = 480;

/** The smallest contrast of text on the veil (WCAG AA for normal text). */
const MINIMUM_CONTRAST = 4.5;

/** What the surface of a sticky heading shows in one scroll position. */
interface BandLook {
  readonly opacity: string;
  readonly backgroundColor: string;
  readonly backdropFilter: string;
  readonly fadeImage: string;
}

/** Selects a design theme for the signed-in account through the settings action. */
async function selectDesignTheme(
  page: Page,
  designTheme: string,
): Promise<void> {
  const answer = await page.request.post("/settings/profile", {
    form: { designTheme, intent: "update-design-theme" },
    maxRedirects: 0,
  });

  expect(answer.status()).toBeLessThan(400);
}

/** The surface behind the first sticky section heading of the page. */
function bandSurface(page: Page): Locator {
  return page.locator(".pages-sticky-band-surface").first();
}

/** Scrolls the nearest scrolling ancestor of the sticky heading. */
async function scrollSettings(page: Page, top: number): Promise<void> {
  await page
    .locator(".pages-sticky-band")
    .first()
    .evaluate((band, offset) => {
      let element: HTMLElement | null = band.parentElement;

      while (element !== null) {
        const overflow = getComputedStyle(element).overflowY;

        if (
          (overflow === "auto" || overflow === "scroll") &&
          element.scrollHeight > element.clientHeight
        ) {
          element.scrollTo({ behavior: "instant", top: offset });

          return;
        }
        element = element.parentElement;
      }
      document.scrollingElement?.scrollTo({ behavior: "instant", top: offset });
    }, top);
}

/** Reads the computed look of the band surface and of its fade. */
function readBand(surface: Locator): Promise<BandLook> {
  return surface.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      backdropFilter: style.backdropFilter,
      backgroundColor: style.backgroundColor,
      fadeImage: getComputedStyle(element, "::after").backgroundImage,
      opacity: style.opacity,
    };
  });
}

/** Red, green and blue of one painted pixel, each 0–255. */
type Rgb = readonly number[];

/** The colors of the heading on its surface, as a browser paints them. */
interface HeadingColors {
  /** The surface over each worst-case backdrop: pure black and pure white. */
  readonly grounds: readonly Rgb[];
  readonly texts: readonly Rgb[];
}

/** Relative luminance of a color (WCAG 2). */
function luminance(rgb: Rgb): number {
  const [red = 0, green = 0, blue = 0] = rgb.map((channel) => {
    const value = channel / 255;

    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Contrast ratio of two colors (WCAG 2). */
function contrastRatio(first: Rgb, second: Rgb): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Paints the heading colors on a one-pixel canvas, so the browser itself
 * resolves and composites every color syntax, including `color-mix()`.
 */
function readHeadingColors(page: Page): Promise<HeadingColors> {
  return page
    .locator(".pages-sticky-band")
    .first()
    .evaluate((band) => {
      const surface = band.querySelector(".pages-sticky-band-surface");
      const texts = [...band.querySelectorAll("h2, p")];
      const context = document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true });

      if (surface === null || context === null || texts.length === 0) {
        throw new Error("The sticky heading has no surface or text.");
      }

      const paint = (colors: readonly string[]): number[] => {
        context.clearRect(0, 0, 1, 1);
        colors.forEach((color) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
        });

        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const veil = getComputedStyle(surface).backgroundColor;

      return {
        grounds: ["#000000", "#ffffff"].map((backdrop) =>
          paint([backdrop, veil]),
        ),
        texts: texts.map((text) => paint([getComputedStyle(text).color])),
      };
    });
}

/**
 * The lowest contrast of the heading text on the band surface, with the
 * surface laid over pure black and pure white, the worst a painting can show
 * through the veil.
 */
async function lowestHeadingContrast(page: Page): Promise<number> {
  const { grounds, texts } = await readHeadingColors(page);

  return Math.min(
    ...grounds.flatMap((ground) =>
      texts.map((text) => contrastRatio(ground, text)),
    ),
  );
}

/** Opens the personal settings at the top and checks the resting heading. */
async function openSettingsAtTop(page: Page): Promise<void> {
  await page.goto("/settings/profile");
  await expect(page.locator(".pages-sticky-band").first()).toBeVisible();
  await scrollSettings(page, 0);
}

/** Keeps a screenshot of the current state for the review of the ticket. */
async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
}

/**
 * Checks the heading of Koi Garden at rest and stuck: invisible at rest,
 * stuck on the translucent, blurred veil whose fade starts from the veil, so
 * no opaque band with a hard edge crosses the painting.
 */
async function expectVeiledBand(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const surface = bandSurface(page);

  await openSettingsAtTop(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-design-theme",
    KOI_GARDEN,
  );
  await expect(page.locator(".pages-app-scene")).toBeVisible();
  await expect.poll(async () => (await readBand(surface)).opacity).toBe("0");
  await attachScreenshot(page, testInfo, `${label}-top`);

  await scrollSettings(page, SCROLL_DISTANCE);
  await expect.poll(async () => (await readBand(surface)).opacity).toBe("1");

  const stuck = await readBand(surface);
  const veil = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--scene-veil")
      .trim(),
  );

  expect(veil).not.toBe("transparent");
  expect(stuck.backdropFilter).toBe("blur(8px)");
  // The surface is the veil: it lets the painting through, unlike an opaque band.
  expect(stuck.backgroundColor).not.toMatch(/^rgb\(/u);
  expect(stuck.backgroundColor).toMatch(/\/ 0\.\d+\)$|, 0\.\d+\)$/u);
  // The fade below the heading starts from the same veil, not from the page color.
  expect(stuck.fadeImage).toContain(stuck.backgroundColor);
  expect(await lowestHeadingContrast(page)).toBeGreaterThanOrEqual(
    MINIMUM_CONTRAST,
  );
  await attachScreenshot(page, testInfo, `${label}-scrolled`);
}

test.describe("PAGE-324: sticky settings heading in Koi Garden", () => {
  test.afterEach(async ({ page }) => {
    await selectDesignTheme(page, STANDARD);
  });

  test("lies on the veil instead of an opaque band, light and dark", async ({
    page,
  }, testInfo) => {
    await selectDesignTheme(page, KOI_GARDEN);
    await expectVeiledBand(page, testInfo, "desktop-light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expectVeiledBand(page, testInfo, "desktop-dark");
  });

  test("lies on the veil at a narrow width", async ({ page }, testInfo) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await selectDesignTheme(page, KOI_GARDEN);
    await expectVeiledBand(page, testInfo, "narrow-light");
  });

  test("stays the opaque page color in the Standard design", async ({
    page,
  }) => {
    const surface = bandSurface(page);

    await selectDesignTheme(page, STANDARD);
    await openSettingsAtTop(page);
    await expect(page.locator(".pages-app-scene")).toBeHidden();
    await expect.poll(async () => (await readBand(surface)).opacity).toBe("1");

    await scrollSettings(page, SCROLL_DISTANCE);

    const stuck = await readBand(surface);
    const pageColor = await page.evaluate(() => {
      const probe = document.createElement("span");

      probe.style.backgroundColor = "var(--color-background)";
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;

      probe.remove();

      return color;
    });

    expect(stuck.opacity).toBe("1");
    expect(stuck.backdropFilter).toBe("none");
    expect(stuck.backgroundColor).toBe(pageColor);
    expect(stuck.backgroundColor).toMatch(/^rgb\(/u);
    expect(stuck.fadeImage).toContain(pageColor);
  });
});
