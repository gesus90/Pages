/** One line of a comparison between two texts. */
export interface DiffLine {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/**
 * Compares two texts line by line.
 *
 * @param before - The earlier text.
 * @param after - The later text.
 * @returns Lines that stay, lines only in `after` and lines only in `before`,
 * in reading order.
 *
 * @remarks
 * Uses the longest common subsequence of lines; pages are at most a few
 * thousand lines, so the quadratic table is small enough.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const width = right.length + 1;
  const table = new Array<number>((left.length + 1) * width).fill(0);
  const cell = (i: number, j: number): number => Number(table[i * width + j]);

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? cell(i + 1, j + 1) + 1
          : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      lines.push({ kind: "same", text: String(left[i]) });
      i += 1;
      j += 1;
    } else if (
      j >= right.length ||
      (i < left.length && cell(i + 1, j) >= cell(i, j + 1))
    ) {
      lines.push({ kind: "removed", text: String(left[i]) });
      i += 1;
    } else {
      lines.push({ kind: "added", text: String(right[j]) });
      j += 1;
    }
  }

  return lines;
}
