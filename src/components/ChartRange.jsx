import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Brush, ResponsiveContainer } from 'recharts';
import { sampleLineRows, stableTimelineRows } from '../chartInteraction.mjs';

function TimelineOverview({ overviewRows: data, x, y, width, height }) {
  const points = useMemo(() => sampleLineRows(data), [data]);
  const values = points.map(row => row.value).filter(value => value != null && Number.isFinite(value));
  const min = Math.min(...values), max = Math.max(...values);
  let connected = false;
  const path = points.map(row => {
    if (row.value == null || !Number.isFinite(row.value)) { connected = false; return ''; }
    const px = x + 5 + row.id / Math.max(1, data.length - 1) * Math.max(0, width - 10);
    const py = y + height - 4 - (max === min ? .5 : (row.value - min) / (max - min)) * (height - 8);
    const command = `${connected ? 'L' : 'M'}${px},${py}`;
    connected = true;
    return command;
  }).join('');
  return <path className="chart-range-overview" d={path} stroke="var(--chart-2)" strokeWidth={1.4} fill="none" pointerEvents="none" aria-hidden="true" />;
}

// Brush 使用独立预览图，避免它的缩放状态截断上方图表的分类上下文。
export default function ChartRange({ rows, interaction }) {
  // Keep the drag domain independent of metric/preview updates as well as selection.
  const trackRef = useRef(null);
  const nextTrack = useMemo(() => rows.map(({ name }) => ({ name })), [rows]);
  const track = stableTimelineRows(trackRef.current, nextTrack);
  trackRef.current = track;
  const timer = useRef(null), callback = useRef(interaction.onRange);
  callback.current = interaction.onRange;
  const chosen = interaction.selection ? rows.map((r, i) => interaction.isSelected(r.__sourceRow) ? i : -1).filter(i => i >= 0) : [];
  const from = chosen[0] ?? 0, to = chosen.at(-1) ?? rows.length - 1;
  const [draft, setDraft] = useState(null);
  useEffect(() => { setDraft(null); clearTimeout(timer.current); }, [from, to, rows]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const start = draft?.startIndex ?? from, end = draft?.endIndex ?? to;
  function commit(range) {
    clearTimeout(timer.current);
    if (!range || !rows[range.startIndex] || !rows[range.endIndex]) return;
    if (range.startIndex === from && range.endIndex === to) return;
    if (range.startIndex === 0 && range.endIndex === rows.length - 1) { if (interaction.selection) interaction.onClear(); }
    else callback.current(rows[range.startIndex].__sourceRow, rows[range.endIndex].__sourceRow);
  }
  return <div className="chart-time-range">
    <div className="chart-range-caption"><strong>时间范围</strong><span>{rows[start]?.name} — {rows[end]?.name}</span><small>拖动两端筛选</small></div>
    <div className="chart-range-preview">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart key={track.length} data={track} margin={{ top: 4, right: 12, bottom: 4, left: 12 }}>
          <Brush dataKey="name" ariaLabel="拖动滑块选择图表时间范围" y={8} height={32} startIndex={start} endIndex={end} travellerWidth={11} stroke="var(--accent)" fill="var(--surface)" onChange={range => {
            if (interaction.disabled || !range || range.startIndex === start && range.endIndex === end) return;
            setDraft(range); clearTimeout(timer.current);
            // 同时支持键盘调整；持续拖动仅更新小预览，停下或松手再计算原始明细。
            timer.current = setTimeout(() => commit(range), 180);
          }} onDragEnd={range => { if (!interaction.disabled) commit(range); }}>
            <TimelineOverview overviewRows={rows} />
          </Brush>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
