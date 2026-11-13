import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const stylesheet = readFileSync("app/styles/tailwind.css", "utf8");
const animation = readFileSync("app/components/ui/toast.module.css", "utf8");

interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function palette(isDark: boolean): Map<string, string> {
  const section = isDark
    ? stylesheet
    : (stylesheet.split("@variant dark")[0] ?? "");
  return new Map(
    [...section.matchAll(/(--color-[\w-]+):\s*([^;]+);/gu)].map((match) => [
      match[1] ?? "",
      match[2]?.trim() ?? "",
    ]),
  );
}

function resolveColor(tokens: ReadonlyMap<string, string>, key: string): Rgb {
  const color = tokens.get(key) ?? "";
  if (/^#[\da-f]{6}$/iu.test(color))
    return {
      red: parseInt(color.slice(1, 3), 16),
      green: parseInt(color.slice(3, 5), 16),
      blue: parseInt(color.slice(5, 7), 16),
    };
  const alias = /^var\((--color-[\w-]+)\)$/u.exec(color)?.[1];
  if (alias) return resolveColor(tokens, alias);
  const mix =
    /^color-mix\(\s*in srgb,\s*var\((--color-[\w-]+)\) (\d+)%,\s*var\((--color-[\w-]+)\)\s*\)$/u.exec(
      color,
    );
  if (!mix?.[1] || !mix[3])
    throw new Error(`Unresolved color ${key}: ${color}`);
  const first = resolveColor(tokens, mix[1]);
  const second = resolveColor(tokens, mix[3]);
  const weight = Number(mix[2]) / 100;
  return {
    red: first.red * weight + second.red * (1 - weight),
    green: first.green * weight + second.green * (1 - weight),
    blue: first.blue * weight + second.blue * (1 - weight),
  };
}

function luminance(color: Rgb): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    (channels[0] ?? 0) * 0.2126 +
    (channels[1] ?? 0) * 0.7152 +
    (channels[2] ?? 0) * 0.0722
  );
}

function contrast(
  tokens: ReadonlyMap<string, string>,
  foreground: string,
  background: string,
): number {
  const first = luminance(resolveColor(tokens, `--color-${foreground}`));
  const second = luminance(resolveColor(tokens, `--color-${background}`));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

it.each([false, true])(
  "meets AA for toast text, symbols and name-derived avatars (dark=%s)",
  (isDark) => {
    const tokens = palette(isDark);
    for (const text of ["foreground", "muted-foreground", "toast-action"])
      expect(contrast(tokens, text, "surface"), text).toBeGreaterThanOrEqual(
        4.5,
      );
    expect(
      contrast(tokens, "toast-action", "primary-subtle"),
    ).toBeGreaterThanOrEqual(4.5);
    for (const symbol of ["success", "info", "warning", "destructive"])
      expect(
        contrast(tokens, symbol, "surface"),
        symbol,
      ).toBeGreaterThanOrEqual(3);
    for (const name of ["sand", "slate", "peach", "sage", "lilac"])
      expect(
        contrast(tokens, "foreground", `avatar-${name}`),
        name,
      ).toBeGreaterThanOrEqual(4.5);
  },
);

it("animates entry and exit for 220 ms, from above on phones and from the right on desktop, reducing to a fade", () => {
  expect(animation).toContain("enter-toast 220ms");
  expect(animation).toContain("leave-toast 220ms");
  expect(animation).toContain("--toast-enter-y: -0.5rem");
  expect(animation).toContain("--toast-enter-x: 0.5rem");
  const reduced = animation.split("@media (prefers-reduced-motion: reduce)")[1];
  expect(reduced).toContain("--toast-enter-x: 0");
  expect(reduced).toContain("--toast-enter-y: 0");
});
