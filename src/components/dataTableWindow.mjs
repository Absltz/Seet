export const TABLE_ROW_HEIGHT = 46;
export const TABLE_HEADER_HEIGHT = 38;
const OVERSCAN_ROWS = 5;

// The sticky header occupies part of the viewport, but it does not consume rows.
export function getTableWindow(rowCount, scrollTop, viewportHeight) {
  const bodyHeight = Math.max(TABLE_ROW_HEIGHT, viewportHeight - TABLE_HEADER_HEIGHT);
  const offset = Math.max(0, Math.min(scrollTop, rowCount * TABLE_ROW_HEIGHT - bodyHeight));
  const start = Math.max(0, Math.floor(offset / TABLE_ROW_HEIGHT) - OVERSCAN_ROWS);
  const end = Math.min(rowCount, Math.ceil((offset + bodyHeight) / TABLE_ROW_HEIGHT) + OVERSCAN_ROWS);
  return {
    start,
    end,
    before: start * TABLE_ROW_HEIGHT,
    after: (rowCount - end) * TABLE_ROW_HEIGHT,
  };
}
