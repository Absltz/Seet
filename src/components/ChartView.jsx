import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import ChartRange from './ChartRange.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from "../format.mjs";
import { chartAvailability } from "../analysis.mjs";
import { chartAxisLayout, chartSeriesRows, chartSourceRows, chartTimelineRows, stableTimelineRows } from '../chartInteraction.mjs';
export default function ChartView({ data, metric, type, interaction = null }) {
  const colors = [
    "var(--accent)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];
  const available = chartAvailability(data, metric.key, type);
  const sourceRows = useMemo(() => chartSourceRows(data, interaction), [data.rows, interaction?.selection, interaction?.isSelected]);
  const rows = useMemo(() => chartSeriesRows({ rows: sourceRows }, metric.key, null, type), [sourceRows, metric.key, type]);
  const rangeData = interaction?.contextData || data;
  const overview = useMemo(() => chartTimelineRows(rangeData, metric.key, interaction?.dimension), [rangeData.rows, metric.key, interaction?.dimension?.key]);
  const timelineRef = useRef(null);
  const timeline = stableTimelineRows(timelineRef.current, overview);
  timelineRef.current = timeline;
  const viewport = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setViewportWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [available.ok]);
  const valueLabelWidth = Math.min(120, Math.max(48, ...rows.map(row => format(row.value).length * 7 + 16)));
  const axisLayout = chartAxisLayout(rows, viewportWidth, valueLabelWidth);
  const scrollable = type !== 'pie' && axisLayout.minWidth > viewportWidth + 1;
  const enabled = !!interaction && !interaction.disabled;
  const selected = row => !interaction?.selection || interaction.isSelected(row.__sourceRow);
  const pick = row => { if (enabled && row) interaction.onSelect(row.__sourceRow); };
  const point = props => {
    const { cx, cy, payload } = props;
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || payload?.value == null) return null;
    return <g className="chart-dot-target" role="button" tabIndex={enabled ? 0 : -1} aria-label={`筛选 ${payload.name}`} aria-pressed={!!interaction?.selection && selected(payload)} onClick={() => pick(payload)} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(payload); }
    }}><circle cx={cx} cy={cy} r={9} fill="transparent" /><circle cx={cx} cy={cy} r={rows.length < 50 ? 4.5 : 2.8} fill={interaction?.selection && selected(payload) ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth={2} opacity={selected(payload) ? 1 : .28} /></g>;
  };
  const common = {
    data: rows,
    margin: { top: 15, right: 16, bottom: 8, left: 0 },
  };
  const axis = (
    <>
      <CartesianGrid
        vertical={false}
        stroke="var(--line)"
        strokeDasharray="3 5"
      />
      <XAxis
        dataKey="name"
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 12 }}
        interval={axisLayout.interval}
        angle={axisLayout.angle}
        textAnchor={axisLayout.textAnchor}
        height={axisLayout.height}
        tickMargin={12}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 12 }}
        width={valueLabelWidth}
        tickFormatter={format}
      />
      <Tooltip
        cursor={{ fill: "var(--raised)" }}
        contentStyle={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          color: "var(--ink)",
        }}
        formatter={(v) => [`${format(v)} ${metric.unit}`, metric.key]}
      />
    </>
  );
  if (!available.ok)
    return (
      <p className="chart-note" role="status">
        {available.reason}
      </p>
    );
  const chartType = type;
  return (
    <>
      <div
        ref={viewport}
        className={`chart-box chart-scroll${interaction ? ' chart-interactive' : ''}`}
        role="region"
        tabIndex={scrollable ? 0 : undefined}
        aria-label={`${metric.key}${chartType === "line" ? "折线图" : chartType === "pie" ? "占比图" : "柱状图"}，完整数值见下方数据表`}
      >
        <div className="chart-stage" style={{ width: chartType === 'pie' ? '100%' : axisLayout.minWidth, height: '100%' }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {chartType === "line" ? (
            <LineChart {...common}>
              {axis}
              <Line
                type="linear"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={
                  interaction ? point : rows.length < 50
                    ? { r: 4, fill: "var(--surface)", strokeWidth: 2 }
                    : false
                }
                activeDot={interaction ? false : { r: 6 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </LineChart>
          ) : chartType === "pie" ? (
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="57%"
                outerRadius="82%"
                paddingAngle={rows.length < 30 ? 2 : 0}
                isAnimationActive={false}
                onClick={enabled ? (entry, index) => pick(rows[index]) : undefined}
              >
                {rows.map((r, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} fillOpacity={selected(r) ? 1 : .2} stroke={interaction?.selection && selected(r) ? 'var(--accent)' : 'var(--surface)'} strokeWidth={interaction?.selection && selected(r) ? 2 : 1} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => [`${format(v)} ${metric.unit}`, metric.key]}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                }}
              />
            </PieChart>
          ) : (
            <BarChart {...common}>
              {axis}
              <Bar
                dataKey="value"
                fill="var(--accent)"
                maxBarSize={38}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
                minPointSize={interaction ? 3 : 0}
                onClick={enabled ? entry => pick(entry?.payload) : undefined}
              >
                {interaction && rows.map((row, i) => <Cell key={i} fillOpacity={selected(row) ? 1 : .2} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
        </div>
      </div>
      {scrollable && <p className="chart-scroll-hint">横向滚动查看全部分类，悬停图形查看完整数值。</p>}
      {interaction?.dimension?.type === 'date' && timeline.length > 1 && chartType !== 'pie' && <ChartRange rows={timeline} interaction={interaction} />}
      {sourceRows.length > rows.length && (
        <p className="chart-note chart-display-note" role="status">
          {chartType === 'line'
            ? `当前范围共 ${sourceRows.length.toLocaleString()} 组，折线覆盖完整范围，保留首尾及各段极值，抽稀显示 ${rows.length.toLocaleString()} 个点。`
            : `当前范围共 ${sourceRows.length.toLocaleString()} 组，柱图仅显示前 ${rows.length} 组（${rows[0]?.name} 至 ${rows.at(-1)?.name}）。`}
          统计与明细使用全部数据，可缩小时间范围或分组汇总查看细节。
        </p>
      )}
      {chartType === "pie" && (
        <div className="pie-legend">
          {rows.map((r, i) => (
            interaction ? <button type="button" key={i} disabled={!enabled} aria-label={`筛选 ${r.name}`} aria-pressed={!!interaction.selection && selected(r)} onClick={() => pick(r)}>
              <i style={{ background: colors[i % colors.length], opacity: selected(r) ? 1 : .25 }} />
              {r.name} {format(r[metric.key])}
            </button> : <span key={i}>
              <i style={{ background: colors[i % colors.length] }} />
              {r.name} {format(r[metric.key])}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
