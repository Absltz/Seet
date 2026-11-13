import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronRight, Columns2, Database, Download, Eye, FileSpreadsheet, FileText, Filter, GripVertical, LayoutGrid, List, LoaderCircle, Maximize2, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { apiRequest } from '../api.mjs';
import { useAssetDeletion } from '../components/AssetDeletion.jsx';
import { csvExport } from '../data.mjs';
import { dimensionsFor } from '../analysis.mjs';
import { format } from '../format.mjs';
import { restoreReport } from '../reportState.mjs';
import ChartBoundary from '../components/ChartBoundary.jsx';
import { boardFields, buildBoardCard, datasetQuality, moveBoardItem } from './board.mjs';
import './library.css';
import BoardCard from './BoardCard.jsx';
import { selectionForRow, selectionForRange, selectionFilters } from '../chartFilters.mjs';

const ChartView = lazy(() => import('../components/ChartView.jsx'));
const ReportStudio = lazy(() => import('../components/ReportStudio.jsx'));
gsap.registerPlugin(useGSAP);
const noop = () => {};
const date = value => value ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
const reportMode = mode => mode === 'ai' ? 'AI 深度报告' : '统计报告';
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function useAccountApi(owner) {
  const live = useRef(true), requests = useRef(new Set());
  useEffect(() => { live.current = true; return () => { live.current = false; for (const pending of requests.current) if (!pending.write) pending.abort.abort(); }; }, [owner]);
  const request = useCallback(async (url, body, method) => {
    const abort = new AbortController(), write = body !== undefined || !!method && method !== 'GET';
    const pending = { abort, write }; requests.current.add(pending);
    try {
      const result = await apiRequest(url, body === undefined ? undefined : { ...body, owner }, {
        ...(method ? { method } : {}), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(50000)]),
        headers: { 'X-Workspace-Owner': encodeURIComponent(owner), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      });
      if ((!live.current && !write) || abort.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      return result;
    } catch (error) {
      if ((!live.current && !write) || abort.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      throw error;
    } finally { requests.current.delete(pending); }
  }, [owner]);
  request.isActive = () => live.current;
  return request;
}
function useBusyReport(busy, onBusyChange) {
  useEffect(() => { onBusyChange(!!busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
}
function useLive() {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}
function Message({ error, loading, retry }) {
  if (loading) return <div className="lib-loading" role="status"><LoaderCircle size={22} className="spin" />正在读取你的空间…</div>;
  if (error) return <div className="lib-error" role="alert"><span>{error}</span><button className="lib-btn" onClick={retry}>重新加载</button></div>;
  return null;
}
function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current.showModal(); return () => previous?.focus?.(); }, []);
  return <dialog className={`lib-dialog${wide ? ' lib-dialog-wide' : ''}`} ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="lib-dialog-inner"><header><h2>{title}</h2><button className="lib-icon" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>{children}</div></dialog>;
}
function SearchBox({ value, onChange, label }) {
  return <label className="lib-search"><Search size={18} aria-hidden="true" /><span className="lib-sr">{label}</span><input type="search" placeholder={label} value={value} onChange={e => onChange(e.target.value)} />{value && <button className="lib-icon" aria-label="清除搜索" onClick={() => onChange('')}><X size={16} /></button>}</label>;
}
function Empty({ icon: Icon = Database, title, text, children }) {
  return <div className="lib-empty"><div className="lib-empty-icon"><Icon size={32} strokeWidth={1.3} /></div><h2>{title}</h2><p>{text}</p>{children}</div>;
}
function DatasetCover({ item }) {
  return <div className="lib-dataset-cover" aria-hidden="true"><div className="lib-cover-heading"><FileSpreadsheet size={19} /><span>数据文件</span><span>{item.category || '未分类'}</span></div><div className="lib-cover-grid"><span>数据行</span><span>数值指标</span><span>分类字段</span><strong>{Number(item.rows).toLocaleString()}</strong><strong>{item.metrics}</strong><strong>{item.dimensions}</strong></div><div className="lib-cover-lines"><i /><i /><i /></div></div>;
}
function DatasetPreview({ item, request, onClose, onChanged, onStart, notify, onBusyChange }) {
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('rows');
  const live = useLive();
  useBusyReport(busy, onBusyChange);
  const [title, setTitle] = useState(item.title), [category, setCategory] = useState(item.category || ''), [editing, setEditing] = useState(false);
  useEffect(() => { let current = true; request(`/api/library/datasets/${encodeURIComponent(item.id)}`).then(result => { if (current) setDetail(result.item); }).catch(e => { if (current && e.name !== 'AbortError') setError(e.message); }); return () => { current = false; }; }, [item.id, request]);
  const dataset = detail?.dataset, quality = dataset ? datasetQuality(dataset) : null;
  const fields = dataset ? [...dimensionsFor(dataset), ...dataset.metrics.map(m => ({ ...m, type: 'number' }))] : [];
  async function save(e) {
    e.preventDefault(); if (!title.trim() || busy) return;
    setBusy(true); setError('');
    try { const result = await request(`/api/library/datasets/${encodeURIComponent(item.id)}`, { title: title.trim(), category: category.trim() }, 'PATCH'); if (!request.isActive()) return; const next = result.item || { ...item, title: title.trim(), category: category.trim() }; onChanged(next); notify('数据集信息已保存'); if (live.current) { setDetail(old => ({ ...old, ...next, dataset: old?.dataset })); setEditing(false); } }
    catch (e) { if (live.current && e.name !== 'AbortError') setError(e.message); } finally { if (live.current) setBusy(false); }
  }
  async function start() { if (!dataset || busy) return; setBusy(true); try { await onStart({ ...dataset, title: detail.title }); } catch (e) { if (live.current && e.name !== 'AbortError') setError(e.message); } finally { if (live.current) setBusy(false); } }
  return <Modal title="数据集预览" onClose={busy ? noop : onClose} wide><div className="lib-preview-heading"><FileSpreadsheet size={28} /><div><h3>{detail?.title || item.title}</h3><p>{detail?.category || item.category || '未分类'} · 更新于 {date(detail?.updatedAt || item.updatedAt)}</p></div><button className="lib-icon" aria-label="重命名与分类" onClick={() => setEditing(v => !v)}><Pencil size={17} /></button></div>
    {editing && <form className="lib-edit-form" onSubmit={save}><label>数据集名称<input autoFocus maxLength={80} value={title} onChange={e => setTitle(e.target.value)} required /></label><label>分类<input maxLength={40} value={category} placeholder="例如：销售、运营" onChange={e => setCategory(e.target.value)} /></label><button className="lib-btn lib-primary" disabled={busy || !title.trim()}><Check size={16} />保存更改</button></form>}
    {error && <p className="lib-inline-error" role="alert">{error}</p>}
    {!dataset ? !error && <Message loading /> : <><div className="lib-quality" aria-label="数据质量摘要"><div><strong>{quality.rows.toLocaleString()}</strong><span>数据行</span></div><div><strong>{quality.fields}</strong><span>字段</span></div><div><strong>{quality.missingCells.toLocaleString()}</strong><span>缺失单元格</span></div><div><strong>{quality.duplicateRows.toLocaleString()}</strong><span>重复行</span></div></div><div className="lib-tabs" role="tablist" aria-label="预览内容"><button role="tab" id="lib-rows-tab" aria-controls="lib-preview-content" aria-selected={tab === 'rows'} onClick={() => setTab('rows')}>原始数据</button><button role="tab" id="lib-fields-tab" aria-controls="lib-preview-content" aria-selected={tab === 'fields'} onClick={() => setTab('fields')}>字段说明</button><span>预览前 {Math.min(30, dataset.rows.length)} 行</span></div><div className="lib-preview-table" role="tabpanel" id="lib-preview-content" aria-labelledby={tab === 'rows' ? 'lib-rows-tab' : 'lib-fields-tab'} tabIndex={0}>{tab === 'rows' ? <table><thead><tr><th scope="col">#</th>{fields.map(f => <th key={f.key} scope="col">{f.key === 'name' ? '分类' : f.key}{f.unit && <small> / {f.unit}</small>}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 30).map((row, i) => <tr key={i}><td>{i + 1}</td>{fields.map(f => <td key={f.key}>{row[f.key] == null ? <span className="lib-missing">缺失</span> : String(row[f.key])}</td>)}</tr>)}</tbody></table> : <table><thead><tr><th>字段名称</th><th>类型</th><th>单位</th></tr></thead><tbody>{fields.map(f => <tr key={f.key}><td>{f.key === 'name' ? '分类' : f.key}</td><td>{f.type === 'number' ? '数值' : f.type === 'date' ? '日期' : '文本'}</td><td>{f.unit || '—'}</td></tr>)}</tbody></table>}</div><footer className="lib-dialog-actions"><button className="lib-btn" onClick={() => download(`${detail.title}.csv`, csvExport({ ...dataset, title: detail.title }), 'text/csv;charset=utf-8')}><Download size={17} />下载 CSV</button><button className="lib-btn lib-primary" disabled={busy} onClick={start}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}开始分析</button></footer></>}
  </Modal>;
}
function DatasetLibrary({ owner, request, onStartDataset, onUpload, notify, onBusyChange }) {
  const {requestDeletion} = useAssetDeletion();
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [search, setSearch] = useState(''), [category, setCategory] = useState(''), [layout, setLayout] = useState('grid'), [selected, setSelected] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  useBusyReport(previewBusy, onBusyChange);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const result = await request('/api/library/datasets'); if (request.isActive()) setItems(result.items || []); } catch (e) { if (request.isActive() && e.name !== 'AbortError') setError(e.message); } finally { if (request.isActive()) setLoading(false); } }, [request]);
  useEffect(() => { load(); }, [load]);
  const categories = [...new Set(items.map(i => i.category).filter(c => c && c !== '未分类'))];
  const filtered = items.filter(i => (!category || (category === '__none' ? !i.category || i.category === '未分类' : i.category === category)) && `${i.title} ${i.category || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><div className="lib-heading"><div><h1>数据集库</h1><p>留存原始数据，让每一次探索有据可循。</p></div><button className="lib-btn lib-primary" onClick={onUpload}><Upload size={17} />导入数据</button></div>
    <div className="lib-toolbar"><SearchBox value={search} onChange={setSearch} label="搜索数据集名称或分类" /><label className="lib-select"><Filter size={16} aria-hidden="true" /><span className="lib-sr">数据集分类</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="">全部分类</option><option value="__none">未分类</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label><div className="lib-view-switch" aria-label="显示方式"><button className="lib-icon" aria-label="卡片视图" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={18} /></button><button className="lib-icon" aria-label="列表视图" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={19} /></button></div></div>
    <div className="lib-section-line"><span>{search || category ? `${filtered.length} 个匹配结果` : `全部数据集`}</span><span>{items.length} 个数据集 · 仅自己可见</span></div>
    <Message error={error} loading={loading} retry={load} />
    {!loading && !error && !items.length && <Empty title="导入你的第一份数据" text="上传表格或在 AI 分析中输入数据，保存后即可在这里管理和再次分析。"><button className="lib-btn lib-primary" onClick={onUpload}><Upload size={17} />导入数据</button></Empty>}
    {!loading && items.length > 0 && !filtered.length && <Empty icon={Search} title="没有找到这份数据" text="试试其他名称，或切换分类。"><button className="lib-btn" onClick={() => { setSearch(''); setCategory(''); }}>清除筛选</button></Empty>}
    {!loading && filtered.length > 0 && <div className={`lib-datasets lib-datasets-${layout}`}>{filtered.map(item => <article className="lib-dataset" key={item.id}>{layout === 'grid' && <button className="lib-cover-button" onClick={() => setSelected(item)} aria-label={`预览 ${item.title}`}><DatasetCover item={item} /></button>}<div className="lib-dataset-info">{layout === 'list' && <FileSpreadsheet className="lib-list-file" size={24} />}<div><button className="lib-title-button" onClick={() => setSelected(item)}>{item.title}</button><p>{layout === 'list' && <span>{item.category || '未分类'} · </span>}{Number(item.rows).toLocaleString()} 行 · {item.metrics} 个指标<span className="lib-list-extra"> · {item.dimensions} 个分类字段</span></p></div><time dateTime={item.updatedAt}>{date(item.updatedAt)}</time></div><div className="lib-dataset-actions"><button className="lib-btn lib-preview-link" onClick={() => setSelected(item)}><Eye size={16} />预览与分析</button><button className="lib-icon" aria-label={`删除 ${item.title}`} onClick={() => requestDeletion({owner,kind:'dataset',id:item.id,title:item.title})}><Trash2 size={16} /></button></div></article>)}</div>}
    {selected && <DatasetPreview key={selected.id} item={selected} request={request} onClose={() => setSelected(null)} onChanged={next => setItems(current => current.map(i => i.id === next.id ? { ...i, ...next } : i))} onStart={onStartDataset} notify={notify} onBusyChange={setPreviewBusy} />}
  </>;
}
function BoardEditor({ item, busy, error, conflict, onReload, onSave, onClose }) {
  const [title, setTitle] = useState(item.title), [note, setNote] = useState(item.note || '');
  return <Modal title="编辑图表信息" onClose={busy ? noop : onClose}><form className="lib-edit-form" onSubmit={e => { e.preventDefault(); onSave({ id: item.id, title: title.trim(), note: note.trim() }); }}><label>图表标题<input autoFocus maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} /></label><label>分析备注<textarea maxLength={1200} rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="记录结论、背景或下一步要关注的变化" /></label>{error && <p className="lib-inline-error" role="alert">{error}</p>}{conflict && <button type="button" className="lib-btn" disabled={busy} onClick={onReload}>重新载入看板，保留填写内容</button>}<div className="lib-dialog-actions"><button type="button" className="lib-btn" disabled={busy} onClick={onClose}>取消</button><button className="lib-btn lib-primary" disabled={busy || conflict || !title.trim()}>保存更改</button></div></form></Modal>;
}
function AnalysisBoard({ owner, request, onUpload, notify, onBusyChange }) {
  const {requestDeletion} = useAssetDeletion();
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editor, setEditor] = useState(null), [dragging, setDragging] = useState(null);
  const [field, setField] = useState(''), [op, setOp] = useState('eq'), [value, setValue] = useState(''), [filter, setFilter] = useState(null);
  const [link, setLink] = useState(null);
  const saving = useRef(false), revision = useRef(0);
  const [conflict, setConflict] = useState(false);
  useBusyReport(busy, onBusyChange);
  const load = useCallback(async () => { if (saving.current) return; setLoading(true); setError(''); try { const result = await request('/api/library/board'); if (!request.isActive()) return; revision.current = result.revision; setItems(result.items || []); setConflict(false); } catch (e) { if (request.isActive() && e.name !== 'AbortError') setError(e.message); } finally { if (request.isActive()) setLoading(false); } }, [request]);
  useEffect(() => { load(); }, [load]);
  const fields = useMemo(() => boardFields(items), [items]), selectedField = fields.find(f => f.key === field);
  const hits = useMemo(() => items.reduce((r, item) => { try { const card = buildBoardCard(item, filter, link?.filters || []); if ((filter || link) && !card.applicable) r.na++; else { r.applicable++; if (card.sourceRows > 0) r.hits++; } } catch { r.failed++; } return r; }, { applicable: 0, hits: 0, na: 0, failed: 0 }), [items, filter, link]);
  async function save(next, closeEditor = false) {
    if (saving.current || conflict || loading) return; saving.current = true; setBusy(true); setError('');
    try { const result = await request('/api/library/board', { items: next, revision: revision.current }, 'PUT'); if (!request.isActive()) return; revision.current = result.revision; setItems(result.items || next); if (closeEditor) setEditor(null); notify('看板已保存'); }
    catch (e) { if (request.isActive() && e.name !== 'AbortError') { if (e.status === 409) { setConflict(true); setError('看板已在其他页面更新。请重新载入最新看板后再保存，当前填写的标题和备注会保留。'); } else setError(e.message); } }
    finally { saving.current = false; if (request.isActive()) { setBusy(false); setDragging(null); } }
  }
  function move(id, target) { const next = moveBoardItem(items, id, target); if (next !== items) save(next); }
  function selectChart(item, contextView, row, last = null) {
    if (busy || loading || conflict) return;
    try {
      const active = link?.id === item.id;
      const selection = last ? selectionForRange(item.dataset, contextView, row, last) : selectionForRow(item.dataset, contextView, row, active ? link.selection : null);
      const next = selectionFilters(item.dataset, contextView, selection);
      for (const card of items) buildBoardCard(card, filter, next);
      setLink(selection ? { id: item.id, selection, filters: next } : null); setError('');
    } catch (e) { setError(e.message); }
  }
  function clearChart() { setLink(null); setError(''); }
  const globalFilters = [...(Array.isArray(filter) ? filter : filter ? [filter] : []), ...(link?.filters || [])];
  const filterDescription = globalFilters.map(f => (f.field === 'name' ? '分类' : f.field) + ' ' + ({ eq: '=', in: '属于', contains: '包含', gte: '≥', lte: '≤' })[f.op] + ' ' + (Array.isArray(f.value) ? f.value.join('、') : String(f.value).replace(/T23:59:59(?:\.999)?Z$/, ''))).join('；');

  return <><div className="lib-heading"><div><h1>分析看板</h1><p>把值得持续关注的图表，放在同一张画布。</p></div><span className="lib-save-status" role="status">{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? '正在保存布局…' : conflict ? '需要重新载入' : '更改自动保存'}</span></div>
    <Message error={error} loading={loading} retry={load} />
    {!loading && !items.length && !error && <Empty icon={LayoutGrid} title="你的第一张看板，从一张图开始" text="在 AI 分析工作台生成图表后，点击“加入看板”。每张图都会保留自己的原始数据和分析口径。"><button className="lib-btn lib-primary" onClick={onUpload}><Plus size={17} />去工作台导入数据</button></Empty>}
    {items.length > 0 && <><form className="lib-board-filter" onSubmit={e => { e.preventDefault(); if (field && value !== '') { setLink(null); setFilter({ field, op, value: selectedField?.type === 'number' ? Number(value) : value }); } }}><div className="lib-filter-heading"><Filter size={18} /><strong>全局筛选</strong><span>点击任一图表联动筛选，也可在此输入条件</span></div><div className="lib-filter-fields"><label><span className="lib-sr">筛选字段</span><select value={field} onChange={e => { setField(e.target.value); setValue(''); setOp('eq'); }}><option value="">选择字段</option>{fields.map(f => <option key={f.key} value={f.key}>{f.key === 'name' ? '分类' : f.key}</option>)}</select></label><label><span className="lib-sr">筛选方式</span><select value={op} onChange={e => setOp(e.target.value)}><option value="eq">等于</option>{selectedField?.type === 'text' ? <option value="contains">包含</option> : <><option value="gte">大于等于</option><option value="lte">小于等于</option></>}</select></label><label className="lib-filter-value"><span className="lib-sr">筛选值</span><input required disabled={!field} type={selectedField?.type === 'number' ? 'number' : selectedField?.type === 'date' ? 'date' : 'text'} step="any" list={selectedField?.type === 'text' ? 'lib-board-values' : undefined} value={value} onChange={e => setValue(e.target.value)} placeholder="输入或选择值" /><datalist id="lib-board-values">{selectedField?.values.map(v => <option key={v} value={v} />)}</datalist></label><button className="lib-btn lib-primary" disabled={!field || value === ''}>应用筛选</button>{(filter || link) && <button type="button" className="lib-btn" onClick={() => { setFilter(null); setLink(null); setField(''); setValue(''); setOp('eq'); }}>清除</button>}</div></form><div className="lib-section-line"><span>{items.length} 张图表{(filter || link) && ` · ${hits.hits} 张有匹配结果 · ${hits.na} 张不适用`}{hits.failed > 0 && ` · ${hits.failed} 张计算失败`}</span><span>{(filter || link) ? filterDescription : '点击图形，查看图表之间的联系'}<span className="lib-drag-hint"> · 拖动手柄调整顺序</span></span></div><div className="lib-board-grid" aria-busy={busy}>{items.map((item, index) => <BoardCard key={item.id} item={item} index={index} count={items.length} filter={filter} link={link} onChartSelect={(item, context, row) => selectChart(item, context, row)} onChartRange={(item, context, first, last) => selectChart(item, context, first, last)} onChartClear={clearChart} busy={busy || conflict || loading} dragging={dragging === item.id} onEdit={() => setEditor(item)} onResize={() => save(items.map(i => i.id === item.id ? { ...i, size: i.size === 'wide' ? 'normal' : 'wide' } : i))} onRemove={() => requestDeletion({owner,kind:'chart',id:item.id,title:item.title})} onMove={target => move(item.id, target)} onDragStart={e => { setDragging(item.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); }} onDrop={target => { if (dragging && !busy) move(dragging, target); }} />)}</div></>}
    {editor && <BoardEditor key={editor.id} item={editor} busy={busy || loading} error={error} conflict={conflict} onReload={load} onClose={() => setEditor(null)} onSave={edited => { if (!items.some(i => i.id === edited.id)) { setError('这张图已在其他页面移除。填写内容仍保留，可复制后关闭编辑。'); return; } save(items.map(i => i.id === edited.id ? { ...i, title: edited.title, note: edited.note } : i), true); }} />}
  </>;
}
function ReportCenter({ request, owner, onOpenRecord, onUpload }) {
  const {requestDeletion} = useAssetDeletion();
  const [reports, setReports] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [search, setSearch] = useState(''), [mode, setMode] = useState(''), [busy, setBusy] = useState(''), [preview, setPreview] = useState(null);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setReports((await request('/api/library/reports')).reports || []); } catch (e) { if (e.name !== 'AbortError') setError(e.message); } finally { if (request.isActive()) setLoading(false); } }, [request]);
  useEffect(() => { load(); }, [load]);
  const filtered = reports.filter(r => (!mode || (mode === 'ai' ? r.mode === 'ai' : r.mode !== 'ai')) && r.title.toLowerCase().includes(search.trim().toLowerCase()));
  async function open(report, asDownload) { if (busy) return; setBusy(report.id); setError(''); try { const response = await request(`/api/analyses/${encodeURIComponent(report.id)}`); const workspace = response.record?.workspace; const restored = restoreReport(workspace?.report); if (!restored) throw new Error('这份报告的 PDF 未能恢复，请打开原分析检查已保存内容。'); if (asDownload) download(restored.result.fileName || `${report.title}.pdf`, restored.result.bytes, 'application/pdf'); else setPreview({ workspace, restored, id: report.id }); } catch (e) { if (e.name !== 'AbortError') setError(e.message); } finally { if (request.isActive()) setBusy(''); } }
  async function original(id) { if (busy) return; setBusy(id); try { await onOpenRecord(id); } catch (e) { if (e.name !== 'AbortError') setError(e.message); } finally { if (request.isActive()) setBusy(''); } }
  return <><div className="lib-heading"><div><h1>报告中心</h1><p>让分析落在纸上，也让结论随时可回看。</p></div><div className="lib-page-aside"><FileText size={18} /><span>已保存的 PDF 报告</span></div></div><div className="lib-toolbar"><SearchBox value={search} onChange={setSearch} label="搜索报告名称" /><label className="lib-select"><Filter size={16} aria-hidden="true" /><span className="lib-sr">报告模式</span><select value={mode} onChange={e => setMode(e.target.value)}><option value="">全部报告模式</option><option value="ai">AI 深度报告</option><option value="statistical">统计报告</option></select></label></div><div className="lib-section-line"><span>{search || mode ? `${filtered.length} 个匹配结果` : '全部报告'}</span><span>{reports.length} 份报告 · 点击预览已保存版本</span></div><Message error={error} loading={loading} retry={load} />
    {!loading && !reports.length && !error && <Empty icon={FileText} title="把一次发现，整理成一份报告" text="在工作台生成并保存分析报告后，PDF 会汇集在这里。你可以直接预览、下载，或回到当时的分析。"><button className="lib-btn lib-primary" onClick={onUpload}>开始一份分析<ArrowRight size={17} /></button></Empty>}
    {!loading && reports.length > 0 && !filtered.length && <Empty icon={Search} title="没有找到这份报告" text="试试其他名称，或查看全部报告。"><button className="lib-btn" onClick={() => { setSearch(''); setMode(''); }}>清除筛选</button></Empty>}
    {!loading && filtered.length > 0 && <div className="lib-reports">{filtered.map(report => <article className="lib-report" key={report.id}><button className="lib-report-cover" disabled={!!busy} onClick={() => open(report, false)} aria-label={`预览报告 ${report.title}`}><div className="lib-paper"><div className="lib-paper-brand"><span />见数分析报告</div><strong>{report.title}</strong><p>{reportMode(report.mode)}</p><div className="lib-paper-rules" aria-hidden="true"><i /><i /><i /></div><div className="lib-paper-meta"><span>{report.pages} 页</span><span>{report.chartCount} 张图表</span></div><div className="lib-paper-date">{date(report.createdAt)}</div></div><span className="lib-report-preview"><Eye size={16} />{busy === report.id ? '正在读取…' : '预览 PDF'}</span></button><div className="lib-report-info"><span className="lib-mode-badge">{reportMode(report.mode)}</span><h2><button className="lib-title-button" disabled={!!busy} onClick={() => open(report, false)}>{report.title}</button></h2><p>{report.pages} 页 · {report.chartCount} 张图表</p><time dateTime={report.createdAt}>生成于 {date(report.createdAt)}</time></div><div className="lib-report-actions"><button className="lib-btn" disabled={!!busy} onClick={() => original(report.id)}>回到原分析<ChevronRight size={16} /></button><button className="lib-icon" disabled={!!busy} aria-label={`下载 ${report.title} PDF`} onClick={() => open(report, true)}><Download size={18} /></button><button className="lib-icon" disabled={!!busy} aria-label={`删除报告 ${report.title}`} onClick={() => requestDeletion({owner,kind:'report',id:report.id,title:report.title})}><Trash2 size={17}/></button></div></article>)}</div>}
    {preview && <Suspense fallback={<div className="lib-loading" role="status">正在打开 PDF 预览…</div>}><ReportStudio key={preview.id} input={{ dataset: preview.workspace.dataset, view: preview.workspace.view, metricKey: preview.workspace.metricKey, chart: preview.workspace.chart, sort: preview.workspace.sort, owner, history: preview.workspace.messages, key: preview.restored.key, recordId: preview.id }} initialResult={preview.restored.result} readOnly backLabel="返回报告中心" onClose={() => setPreview(null)} /></Suspense>}
  </>;
}
function AccountPages({ page, user, onStartDataset, onUpload, onOpenRecord, onNotice, onBusyChange }) {
  const request = useAccountApi(user.username), root = useRef(null);
  useGSAP(() => { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; gsap.from('.lib-heading', { opacity: 0, y: 8, duration: .32, ease: 'power2.out' }); }, { scope: root, dependencies: [page], revertOnUpdate: true });
  return <main className="library-page" ref={root}><div className="library-content">{page === '/datasets' ? <DatasetLibrary owner={user.username} request={request} onStartDataset={onStartDataset} onUpload={onUpload} notify={onNotice} onBusyChange={onBusyChange} /> : page === '/boards' ? <AnalysisBoard owner={user.username} request={request} onUpload={onUpload} notify={onNotice} onBusyChange={onBusyChange} /> : <ReportCenter request={request} owner={user.username} onOpenRecord={onOpenRecord} onUpload={onUpload} />}</div></main>;
}
export default function LibraryPages({ page, user, onStartDataset = noop, onUpload = noop, onOpenRecord = noop, onNotice = noop, onBusyChange = noop }) {
  if (!user?.username) return null;
  return <AccountPages key={`${user.username}:${page}`} page={page} user={user} onStartDataset={onStartDataset} onUpload={onUpload} onOpenRecord={onOpenRecord} onNotice={onNotice} onBusyChange={onBusyChange} />;
}
