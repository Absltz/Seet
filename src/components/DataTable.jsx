import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { format } from "../format.mjs";
import { getTableWindow, TABLE_ROW_HEIGHT } from "./dataTableWindow.mjs";
import "./data-table.css";

const previewNumberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function DataTable({
  dataset,
  onChange,
  editing = false,
  limit,
}) {
  const [page, setPage] = useState(0),
    size = 50,
    pages = Math.max(1, Math.ceil(dataset.rows.length / size));
  useEffect(() => setPage(0), [dataset.title, dataset.rows.length]);
  const virtualized = Boolean(limit) && !editing;
  const rowCount = limit ? Math.min(dataset.rows.length, limit) : dataset.rows.length;
  const wrapRef = useRef(null);
  const scrollFrame = useRef(null);
  const [visibleWindow, setVisibleWindow] = useState(() => getTableWindow(rowCount, 0, 300));
  const syncWindow = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const next = getTableWindow(rowCount, wrap.scrollTop, wrap.clientHeight);
    setVisibleWindow(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  }, [rowCount]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const wrap = wrapRef.current;
    wrap.scrollTop = 0;
    syncWindow();
    const observer = new ResizeObserver(syncWindow);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    };
  }, [dataset, virtualized, syncWindow]);

  function handleScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      syncWindow();
    });
  }

  const current = Math.min(page, pages - 1),
    start = virtualized ? Math.min(visibleWindow.start, rowCount) : limit ? 0 : current * size,
    end = virtualized ? Math.min(visibleWindow.end, rowCount) : limit || start + size,
    rows = dataset.rows.slice(start, end),
    dims = dataset.dimensions || [];
  // Widths depend on the schema, never the current window's values.
  const columnWidths = useMemo(() => [
    ...(dataset.dimensions?.length ? dataset.dimensions : [{ key: "name", label: "分类" }]).map(d => Math.max(180, Math.min(360, String(d.label || d.key).length * 14 + 24))),
    ...dataset.metrics.map(m => Math.max(144, Math.min(360, (m.key.length + (m.unit?.length || 0) + 3) * 14 + 24))),
  ], [dataset.dimensions, dataset.metrics]);
  function update(index, key, value) {
    const next = { ...dataset, rows: [...dataset.rows] };
    next.rows[index] = {
      ...next.rows[index],
      [key]:
        key === "name" || dims.some((d) => d.key === key)
          ? value
          : value.trim() === ""
            ? null
            : Number(value),
    };
    if (
      key !== "name" &&
      !dims.some((d) => d.key === key) &&
      next.rows[index][key] !== null &&
      (!Number.isFinite(next.rows[index][key]) ||
        Math.abs(next.rows[index][key]) > 1e15)
    )
      return;
    onChange(next);
  }
  const fields = dims.length ? dims : [{ key: "name", label: "分类" }];
  return (
    <>
      <div ref={wrapRef} className={`table-wrap${virtualized ? " data-table-virtual" : ""}`} onScroll={virtualized ? handleScroll : undefined} tabIndex={limit ? 0 : undefined} role={limit ? 'region' : undefined} aria-label={limit ? '筛选后的全部原始数据' : undefined}>
        <table className={virtualized ? "data-table-grid" : undefined} style={virtualized ? { width: columnWidths.reduce((sum, width) => sum + width, 0) } : undefined} aria-rowcount={virtualized ? rowCount + 1 : undefined}>
          {virtualized && <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>}
          <thead>
            <tr>
              {fields.map((d) => (
                <th key={d.key} title={virtualized ? d.label || d.key : undefined}>{d.label || d.key}</th>
              ))}
              {dataset.metrics.map((m) => (
                <th className="num" key={m.key} title={virtualized ? `${m.key}${m.unit ? ` / ${m.unit}` : ""}` : undefined}>
                  {m.key}
                  {m.unit && <span className="table-unit"> / {m.unit}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {virtualized && start > 0 && <tr className="data-table-spacer" aria-hidden="true"><td colSpan={columnWidths.length} style={{ height: start * TABLE_ROW_HEIGHT }} /></tr>}
            {rows.map((r, i) => (
              <tr key={start + i} data-row-index={virtualized ? start + i : undefined} aria-rowindex={virtualized ? start + i + 2 : undefined}>
                {fields.map((d) => (
                  <td key={d.key}>
                    {editing ? (
                      <input
                        aria-label={`第${start + i + 1}行${d.label || d.key}`}
                        value={r[d.key] ?? ""}
                        maxLength={200}
                        onChange={(e) =>
                          update(start + i, d.key, e.target.value)
                        }
                      />
                    ) : virtualized ? (
                      <span className="data-table-cell" title={r[d.key] == null ? undefined : String(r[d.key])}>{r[d.key] ?? "—"}</span>
                    ) : (
                      (r[d.key] ?? "—")
                    )}
                  </td>
                ))}
                {dataset.metrics.map((m) => (
                  <td className="num" key={m.key}>
                    {editing ? (
                      <input
                        type="number"
                        step="any"
                        aria-label={`第${start + i + 1}行${m.key}`}
                        value={r[m.key] ?? ""}
                        onChange={(e) =>
                          update(start + i, m.key, e.target.value)
                        }
                      />
                    ) : virtualized ? (
                      <span className="data-table-cell" title={r[m.key] == null ? undefined : String(r[m.key])}>{r[m.key] == null ? "—" : previewNumberFormat.format(r[m.key])}</span>
                    ) : (
                      format(r[m.key])
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {virtualized && end < rowCount && <tr className="data-table-spacer" aria-hidden="true"><td colSpan={columnWidths.length} style={{ height: (rowCount - end) * TABLE_ROW_HEIGHT }} /></tr>}
          </tbody>
        </table>
      </div>
      {!limit && pages > 1 && (
        <nav className="table-pagination" aria-label="数据表分页">
          <span>
            共 {dataset.rows.length} 行，当前 {start + 1}–
            {Math.min(start + size, dataset.rows.length)} 行
          </span>
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            上一页
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            disabled={current + 1 === pages}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </>
  );
}

export default memo(DataTable);
