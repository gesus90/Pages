import { LoadDonut } from "./load-donut";
import { LoadSparkline } from "./load-sparkline";

import type { LoadSample } from "./load-history";

interface LoadTileProps {
  readonly name: string;
  /** The value in the ring, such as `46 %`. */
  readonly value: string;
  /** The share the ring and its color show; `null` leaves the ring empty. */
  readonly ratio: number | null;
  /** The first line of details; `null` leaves it out. */
  readonly detail: string | null;
  /** The second line of details; `null` leaves it out. */
  readonly secondDetail: string | null;
  readonly samples: readonly LoadSample[];
  /** The time of the newest reading, where the curve ends. */
  readonly end: number | null;
}

function DetailLine({
  text,
}: {
  readonly text: string | null;
}): React.ReactElement | null {
  if (text === null) return null;
  return (
    <p className="mt-1 text-[13px] leading-snug break-words text-muted-foreground tabular-nums">
      {text}
    </p>
  );
}

/** One tile of the load section: ring, name, details and the curve of ten minutes. */
export function LoadTile({
  name,
  value,
  ratio,
  detail,
  secondDetail,
  samples,
  end,
}: LoadTileProps): React.ReactElement {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <LoadDonut ratio={ratio} label={value} />
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-foreground">
            {name}
          </h4>
          <DetailLine text={detail} />
          <DetailLine text={secondDetail} />
        </div>
      </div>
      <LoadSparkline samples={samples} end={end} />
    </article>
  );
}
