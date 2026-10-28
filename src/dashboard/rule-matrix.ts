/**
 * The pure half of the "rule matrix" widget: turn flat rows of (row label, column label, count) into
 * a grid, with the heaviest rows and columns first so the pattern reads at a glance.
 */

export interface MatrixCell {
  count: number;
  /** 0..1, relative to the busiest cell; drives the colour. */
  intensity: number;
}

export interface Matrix {
  rows: string[];
  columns: string[];
  /** cells[r][c]; undefined where nothing was recorded. */
  cells: (MatrixCell | undefined)[][];
  total: number;
  max: number;
}

const label = (v: unknown) => (v === null || v === undefined || v === "" ? "None" : String(v));

export function buildMatrix(rows: { row: unknown; column: unknown; value: unknown }[]): Matrix {
  const counts = new Map<string, Map<string, number>>();
  const rowTotal = new Map<string, number>();
  const columnTotal = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const row = label(r.row);
    const column = label(r.column);
    const line = counts.get(row) ?? new Map<string, number>();
    line.set(column, (line.get(column) ?? 0) + n);
    counts.set(row, line);
    rowTotal.set(row, (rowTotal.get(row) ?? 0) + n);
    columnTotal.set(column, (columnTotal.get(column) ?? 0) + n);
    total += n;
  }
  const byWeight = (totals: Map<string, number>) => [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const rowOrder = byWeight(rowTotal);
  const columnOrder = byWeight(columnTotal);
  let max = 0;
  for (const line of counts.values()) for (const n of line.values()) max = Math.max(max, n);
  const cells = rowOrder.map((r) =>
    columnOrder.map((c) => {
      const count = counts.get(r)?.get(c);
      return count === undefined ? undefined : { count, intensity: max ? count / max : 0 };
    }),
  );
  return { rows: rowOrder, columns: columnOrder, cells, total, max };
}

/**
 * Read one flat result row. Studio keys a row by the field it came from; when the key is not the
 * field's id, fall back to the order the fields were requested in.
 */
export function readRow(row: Record<string, unknown>, ids: [string, string, string]): { row: unknown; column: unknown; value: unknown } {
  if (ids.every((id) => id in row)) return { row: row[ids[0]], column: row[ids[1]], value: row[ids[2]] };
  const values = Object.values(row);
  return { row: values[0], column: values[1], value: values[2] };
}
