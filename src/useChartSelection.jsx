import { useEffect, useMemo, useState } from 'react';
import { buildView, defaultView, validateView } from './analysis.mjs';
import { chartDimension, mergeChartSelection, rowSelected, selectionForRange, selectionForRow } from './chartFilters.mjs';

// view 始终是统计、明细、AI 和记录的唯一口径；这里只保留可供继续点选的背景视图。
export function useChartSelection(dataset, view, setView) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const current = useMemo(() => dataset ? validateView(dataset, view || defaultView(dataset)) : null, [dataset, view]);
  const active = !!entry && entry.dataset === dataset && entry.appliedView === view;
  const baseView = active ? entry.baseView : current;
  const selection = active ? entry.selection : null;
  const contextData = useMemo(() => dataset ? buildView(dataset, baseView) : null, [dataset, baseView]);
  const dimension = dataset ? chartDimension(dataset, baseView) : null;
  useEffect(() => {
    if (entry && !active) setEntry(null);
    setError('');
  }, [dataset, view, entry, active]);
  function commit(next) {
    if (!dataset) return;
    try {
      const applied = mergeChartSelection(dataset, baseView, next);
      setEntry(next ? { dataset, baseView, selection: next, appliedView: applied } : null);
      setView(applied);
      setError('');
    } catch (e) { setError(e.message); }
  }
  return {
    contextData, baseView, selection, dimension, error,
    onSelect(row) { try { commit(selectionForRow(dataset, baseView, row, selection)); } catch (e) { setError(e.message); } },
    onRange(first, last) { try { commit(selectionForRange(dataset, baseView, first, last)); } catch (e) { setError(e.message); } },
    onClear() { commit(null); },
    isSelected(row) { return rowSelected(dataset, baseView, row, selection); },
  };
}
