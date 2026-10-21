const surfaceColors = new Map<string, string>();

function compositeSurface(colors: readonly string[]): string {
  const key = colors.join(";");
  const cached = surfaceColors.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return colors[0];
  for (const color of colors.toReversed()) {
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
  }
  const pixel = context.getImageData(0, 0, 1, 1).data;
  const result = `rgb(${pixel[0]} ${pixel[1]} ${pixel[2]})`;
  surfaceColors.set(key, result);
  return result;
}

/** Resolves themed, translucent ancestors against their actual underlying surface. */
export function scrollSurfaceColor(viewport: HTMLElement): string {
  const colors: string[] = [];
  let ancestor: HTMLElement | null = viewport;
  while (ancestor) {
    const background = getComputedStyle(ancestor).backgroundColor;
    ancestor = ancestor.parentElement;
    if (background === "rgba(0, 0, 0, 0)" || background === "transparent")
      continue;
    colors.push(background);
    if (background.includes("/") || background.startsWith("rgba(")) continue;
    return colors.length === 1 ? background : compositeSurface(colors);
  }
  return "var(--scroll-fade-color)";
}
