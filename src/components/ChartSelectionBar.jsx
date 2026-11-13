import { useMemo, useState } from 'react';
import { ChevronDown, Filter, RotateCcw, Search } from 'lucide-react';

export default function ChartSelectionBar({ data, interaction, sourceRows, totalRows, disabled = false, controls, filters, context }) {
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const dateMode = interaction.dimension?.type === 'date';
  const options = useMemo(() => {
    const seen = new Set();
    const list = (data?.rows || []).filter(row => {
      const key = row.name;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return dateMode ? list.sort((a, b) => String(a.name).localeCompare(String(b.name))) : list;
  }, [data, dateMode]);
  const matches = options.filter(row => String(row.name).toLowerCase().includes(search.toLowerCase())).slice(0, 200);
  const selected = pickerOpen && dateMode && interaction.selection ? options.map((row, i) => interaction.isSelected(row) ? i : -1).filter(i => i >= 0) : [];
  const start = selected[0] ?? 0, end = selected.at(-1) ?? Math.max(0, options.length - 1);
  return <div className="chart-selection-bar chart-control-bar" aria-label="图表分析与筛选">
    <div className="chart-selection-top">
      <div className="chart-control-inputs">{controls}</div>
      <div className="chart-selection-actions">
        <details className="chart-selection-picker" name="chart-analysis-controls" onToggle={e => setPickerOpen(e.currentTarget.open)} onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}}>
          <summary aria-disabled={disabled} onClick={e=>{if(disabled)e.preventDefault()}}><Filter size={14}/>{dateMode ? '选择时间范围' : '筛选分类'}<ChevronDown size={13} /></summary>
          {pickerOpen && <div className="chart-selection-popover">
            <p className="chart-picker-help">{dateMode ? '也可直接在图表中拖选时间范围。' : '也可点击图形筛选，支持连续多选。'}</p>
            {dateMode ? <div className="chart-date-fields">
              <label>开始<select aria-label="筛选开始时间" disabled={disabled} value={start} onChange={e => interaction.onRange(options[Number(e.target.value)], options[Math.max(Number(e.target.value), end)])}>{options.map((row, i) => <option key={i} value={i}>{row.name}</option>)}</select></label>
              <label>结束<select aria-label="筛选结束时间" disabled={disabled} value={end} onChange={e => interaction.onRange(options[Math.min(start, Number(e.target.value))], options[Number(e.target.value)])}>{options.map((row, i) => <option key={i} value={i}>{row.name}</option>)}</select></label>
            </div> : <>
              <label className="chart-selection-search"><Search size={15} /><input aria-label="搜索图表分类" placeholder="搜索分类" value={search} onChange={e => setSearch(e.target.value)} /></label>
              <div className="chart-selection-options" role="group" aria-label="可筛选分类">{matches.map((row, i) => <button type="button" key={i} disabled={disabled} aria-pressed={!!interaction.selection && interaction.isSelected(row)} onClick={() => interaction.onSelect(row)}><span className="chart-choice-box" aria-hidden="true">{!!interaction.selection && interaction.isSelected(row) ? '✓' : ''}</span>{row.name}</button>)}</div>
              {!matches.length && <p>没有匹配的分类</p>}
              {options.length > 200 && <p>最多显示 200 项，可搜索更多分类。</p>}
            </>}
            {interaction.selection && <button type="button" className="chart-selection-reset" disabled={disabled} onClick={interaction.onClear}><RotateCcw size={14} />恢复本次选择</button>}
          </div>}
        </details>
      </div>
    </div>
    <div className="chart-control-bottom"><span className="chart-control-context">{context}</span>{filters}<div className="chart-selection-result" role="status" aria-live="polite">{sourceRows != null && <span>{sourceRows.toLocaleString()} / {totalRows.toLocaleString()} 行</span>}</div></div>
    {interaction.error && <p className="chart-selection-error" role="alert">{interaction.error}</p>}
  </div>;
}
