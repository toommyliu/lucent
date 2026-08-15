export interface GameViewBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const partition = (
  size: number,
  index: number,
  parts: number,
): { readonly offset: number; readonly size: number } => {
  const normalizedSize = Math.max(1, Math.round(size));
  const start = Math.floor((normalizedSize * index) / parts);
  const end = Math.floor((normalizedSize * (index + 1)) / parts);
  return { offset: start, size: Math.max(1, end - start) };
};

export const gameViewGridDimensions = (
  count: number,
): { readonly columns: number; readonly rows: number } => {
  const normalizedCount = Math.max(1, Math.floor(count));
  const columns = Math.ceil(Math.sqrt(normalizedCount));
  return { columns, rows: Math.ceil(normalizedCount / columns) };
};

export const focusedGameViewBounds = (
  width: number,
  height: number,
  topInset: number,
): GameViewBounds => ({
  height: Math.max(1, Math.round(height) - topInset),
  width: Math.max(1, Math.round(width)),
  x: 0,
  y: topInset,
});

export const gridGameViewBounds = (
  width: number,
  height: number,
  topInset: number,
  index: number,
  count: number,
): GameViewBounds => {
  const { columns, rows } = gameViewGridDimensions(count);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = partition(width, column, columns);
  const y = partition(Math.max(1, height - topInset), row, rows);

  return {
    height: y.size,
    width: x.size,
    x: x.offset,
    y: topInset + y.offset,
  };
};
