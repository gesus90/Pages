/**
 * Static circuit traces for the navigation margin, never for content surfaces.
 *
 * @param colors - Line and node inks of the resolved palette.
 * @returns A self-contained SVG background with deliberately faint strokes.
 */
export function neuralCircuitTexture(
  colors: readonly [string, string, string],
): string {
  const [line, node, secondaryNode] = colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="680" viewBox="0 0 280 680">
    <g fill="none" stroke="${line}" stroke-opacity=".2" stroke-width="1">
      <path d="M32 0v112l68 68v174M176 0v96l48 48v158l-40 40v102M16 404v104l56 56v80M138 390v72l-32 32v124l60 60M0 74h58l56 56h54l34 34h78M0 286h82l24-24h52l40 40h82M0 632h58l56-56h42l42 42h82"/>
    </g>
    <g fill="${node}" fill-opacity=".24"><circle cx="100" cy="354" r="3"/><circle cx="202" cy="164" r="3"/><circle cx="72" cy="644" r="3"/></g>
    <g fill="${secondaryNode}" fill-opacity=".24"><circle cx="176" cy="96" r="3"/><circle cx="106" cy="262" r="3"/><circle cx="106" cy="494" r="3"/><circle cx="198" cy="618" r="3"/></g>
  </svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
