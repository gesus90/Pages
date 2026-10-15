import { cn } from "@/app/lib/cn";

// `no-inline` keeps the mascot a file of its own: the browser loads and caches
// it once instead of finding it as a data URL in every server-rendered page.
import picaMascotUrl from "@/assets/pica/pica_maskottchen.svg?no-inline";

interface PicaMascotProps {
  /** Size of the mascot, for example `size-7`; the canvas is square. */
  readonly className: string;
}

/**
 * Pica's mascot from `assets/pica/pica_maskottchen.svg` (PAGE-51), the one
 * graphic that stands for Pica wherever Pica appears.
 *
 * @remarks
 * The mascot is decorative: the button, heading or message around it names
 * Pica for assistive technology. It keeps its square canvas and is never
 * clipped to a round or rounded frame, so the folded corner and the waving flap
 * stay whole at every size.
 */
export function PicaMascot({ className }: PicaMascotProps): React.ReactElement {
  return (
    <img
      alt=""
      className={cn("shrink-0 object-contain", className)}
      draggable={false}
      src={picaMascotUrl}
    />
  );
}
