import { lazy, Suspense, useMemo } from 'react';
import { ArrowDown, ArrowUp, Columns2, Filter, GripVertical, Maximize2, Pencil, Trash2 } from 'lucide-react';
import { chartDimension, rowSelected } from '../chartFilters.mjs';
import { format } from '../format.mjs';
import ChartBoundary from '../components/ChartBoundary.jsx';
import ChartSelectionBar from '../components/ChartSelectionBar.jsx';
import { buildBoardCard, viewForCard } from './board.mjs';
import { metricHeadline } from '../metricHeadline.mjs';

const ChartView = lazy(() => import('../components/ChartView.jsx'));
export default function BoardCard({ item, index, count, filter, link, busy, onEdit, onResize, onRemove, onMove, onDragStart, onDrop, dragging, onChartSelect, onChartRange, onChartClear }) {
  const computed = useMemo(() => { try { return buildBoardCard(item, filter, link?.filters || []); } catch (e) { return { error: e.message }; } }, [item, filter, link]);
  const active = link?.id === item.id;
  const backgroundFilters = active ? [] : link?.filters || [];
  const background = useMemo(() => {
    try { return { ...buildBoardCard(item, filter, backgroundFilters), view: viewForCard(item, filter, backgroundFilters).view }; }
    catch (e) { return { error: e.message }; }
  }, [item, filter, active, link]);
  const view = item.view || {}, filters = view.filters || [];
  const global = [...(Array.isArray(filter) ? filter : filter ? [filter] : []), ...(link?.filters || [])];
  const headline = useMemo(() => computed.error ? null : metricHeadline(item.dataset,viewForCard(item,filter,link?.filters||[]).view,computed.metric.key,computed.stats),[item,filter,link,computed]);
  const interaction = !background.error ? {
    selection: active ? link.selection : null,
    dimension: chartDimension(item.dataset, background.view), disabled: busy,
    isSelected: row => rowSelected(item.dataset, background.view, row, active ? link.selection : null),
    onSelect: row => onChartSelect(item, background.view, row),
    onRange: (first, last) => onChartRange(item, background.view, first, last),
    onClear: onChartClear,
  } : null;
  return <article className={`lib-board-card ${item.size === 'wide' ? 'lib-board-wide' : ''}${dragging ? ' lib-dragging' : ''}`} onDragOver={e => { if (!busy) e.preventDefault(); }} onDrop={e => { e.preventDefault(); onDrop(index); }}>
    <header><div className="lib-board-title"><button className="lib-icon lib-drag-handle" draggable={!busy} onDragStart={onDragStart} aria-label={`拖动 ${item.title}；也可使用上移和下移按钮`} title="拖动排序" disabled={busy}><GripVertical size={18} /></button><div><h2>{item.title}</h2><p>{item.dataset.title}</p></div></div><div className="lib-board-tools"><button className="lib-icon" aria-label={`编辑 ${item.title}`} disabled={busy} onClick={onEdit}><Pencil size={16} /></button><button className="lib-icon" aria-label={item.size === 'wide' ? '切换为标准宽度' : '切换为通栏宽度'} aria-pressed={item.size === 'wide'} disabled={busy} onClick={onResize}>{item.size === 'wide' ? <Columns2 size={16} /> : <Maximize2 size={16} />}</button><button className="lib-icon" aria-label={`移除 ${item.title}`} disabled={busy} onClick={onRemove}><Trash2 size={16} /></button></div></header>
    <div className="lib-board-scope"><span>{view.groupBy ? `按 ${view.groupBy === 'name' ? '分类' : view.groupBy} 汇总` : '原始数据'}{view.granularity && view.granularity !== 'none' ? ` / ${{ day: '日', month: '月', year: '年' }[view.granularity]}` : ''}</span><span>{filters.length ? `${filters.length} 个图内筛选` : '无图内筛选'}</span>{global.length > 0 && <span className={computed.applicable ? 'lib-filter-applied' : 'lib-filter-na'}>{computed.applicable ? '已应用联动筛选' : '联动字段不适用'}</span>}</div>
    {filters.length > 0 && <p className="lib-local-filters">{filters.map((f, i) => <span key={i}>{f.field === 'name' ? '分类' : f.field} {({ eq: '=', in: '属于', contains: '包含', gte: '≥', lte: '≤' })[f.op]} {Array.isArray(f.value) ? f.value.join('、') : String(f.value)}{global.some(g => g.field === f.field) && computed.applicable ? '（由联动条件覆盖）' : ''}</span>)}</p>}
    {computed.error || background.error ? <p className="lib-card-message" role="alert">{computed.error || background.error}</p> : <>
      <ChartSelectionBar data={background.data} interaction={interaction} sourceRows={computed.sourceRows} totalRows={item.dataset.rows.length} disabled={busy} />
      {!computed.data.rows.length ? <div className="lib-chart-empty"><Filter size={24} /><strong>当前筛选下没有数据</strong><span>调整联动条件，或检查图内筛选。</span></div> : <>
        <div className="lib-board-stat"><span>{headline.label} · {headline.caption}</span><strong>{format(headline.value)}<small>{headline.unit || computed.metric.unit}</small></strong></div>
        <ChartBoundary><Suspense fallback={<div className="lib-chart-empty" role="status">正在加载图表…</div>}><ChartView data={background.data} metric={computed.metric} type={item.chart} interaction={interaction} /></Suspense></ChartBoundary>
        <details className="lib-chart-data"><summary>查看筛选后的图表数值</summary><div className="lib-table-scroll" tabIndex={0}><table><thead><tr><th>分类</th><th>{computed.metric.key}</th></tr></thead><tbody>{computed.data.rows.slice(0, 200).map((row, i) => <tr key={i}><td>{row.name}</td><td>{row[computed.metric.key] == null ? '缺失' : format(row[computed.metric.key])}</td></tr>)}</tbody></table></div>{computed.data.rows.length > 200 && <p>明细预览显示前 200 类，完整范围见图表或原始数据。</p>}</details>
      </>}
    </>}
    {item.note && <p className="lib-board-note">{item.note}</p>}{item.question && <p className="lib-board-question">分析问题：{item.question}</p>}
    <footer><span>{computed.error ? '计算未完成' : `${computed.sourceRows.toLocaleString()} / ${item.dataset.rows.length.toLocaleString()} 行原始数据`}</span><div><button className="lib-icon" aria-label={`上移 ${item.title}`} disabled={busy || index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={15} /></button><button className="lib-icon" aria-label={`下移 ${item.title}`} disabled={busy || index === count - 1} onClick={() => onMove(index + 1)}><ArrowDown size={15} /></button></div></footer>
  </article>;
}
