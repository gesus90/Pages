import qrcode from "qrcode-generator";

interface DiscordQrCodeProps {
  /** The text to encode: the official Discord authorization link. */
  readonly value: string;
  readonly label: string;
}

/** The dark modules of the code as one path, a unit square per module. */
function buildModulePath(
  code: ReturnType<typeof qrcode>,
  size: number,
): string {
  const squares: string[] = [];

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (code.isDark(row, column)) {
        squares.push(`M${column} ${row}h1v1h-1z`);
      }
    }
  }

  return squares.join("");
}

/**
 * Draws a QR code as inline SVG.
 *
 * @remarks
 * The code is black on white in both themes on purpose: scanners expect dark
 * modules on a light background and a theme color would break the scan. The
 * code only carries the Discord link; it proves nothing by itself.
 */
export function DiscordQrCode({
  value,
  label,
}: DiscordQrCodeProps): React.ReactElement {
  const code = qrcode(0, "M");

  code.addData(value);
  code.make();

  const size = code.getModuleCount();
  const quietZone = 3;
  const extent = size + quietZone * 2;

  return (
    <svg
      aria-label={label}
      className="size-48 shrink-0 rounded-xl border border-border"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${extent} ${extent}`}
    >
      <rect fill="#ffffff" height={extent} width={extent} />
      <path
        d={buildModulePath(code, size)}
        fill="#000000"
        transform={`translate(${quietZone} ${quietZone})`}
      />
    </svg>
  );
}
