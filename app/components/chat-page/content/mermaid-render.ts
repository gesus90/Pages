/** The outcome of drawing a Mermaid diagram. */
export type MermaidResult =
  | { readonly isValid: true; readonly svg: string }
  | { readonly isValid: false; readonly message: string };

/** The theme tokens of Pages the diagram takes its colors from. */
const THEME_TOKENS = {
  background: "--color-surface",
  primaryColor: "--color-primary-subtle",
  primaryBorderColor: "--color-primary",
  primaryTextColor: "--color-foreground",
  secondaryColor: "--color-muted",
  tertiaryColor: "--color-panel-body",
  lineColor: "--color-muted-foreground",
  textColor: "--color-foreground",
  mainBkg: "--color-primary-subtle",
  nodeBorder: "--color-primary",
  noteBkgColor: "--color-notice-subtle",
  noteTextColor: "--color-foreground",
} as const;

let renderCount = 0;

/** The current values of the theme tokens, so a diagram follows the theme. */
function themeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const [name, token] of Object.entries(THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (value !== "") variables[name] = value;
  }
  return variables;
}

/**
 * Draws a Mermaid diagram as SVG: flowcharts, sequence, state and
 * class diagrams and every other kind Mermaid knows.
 * @remarks
 * Mermaid is loaded only when a diagram is shown. It runs with the strict
 * security level: labels are sanitized, and neither scripts nor click
 * handlers of the diagram text run. The colors come from the theme tokens.
 * @param source - The text of the diagram.
 * @returns The SVG, or the message of the error in the text.
 */
export async function renderMermaid(source: string): Promise<MermaidResult> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: themeVariables(),
    fontFamily: "inherit",
  });
  renderCount += 1;
  try {
    await mermaid.parse(source);
    const { svg } = await mermaid.render(
      `pages-mermaid-${String(renderCount)}`,
      source,
    );
    return { isValid: true, svg };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { isValid: false, message };
  }
}
