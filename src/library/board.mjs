import {
  buildView, chartAvailability, defaultView, dimensionsFor, filterSource, validateView,
} from '../analysis.mjs';
import { summarize } from '../data.mjs';

const fieldsFor = dataset => [
  ...dimensionsFor(dataset),
  ...dataset.metrics.map(metric => ({ key: metric.key, type: 'number' })),
];
const isMissing = value => value == null || typeof value === 'string' && value.trim() === '';

// 使用原始数据列生成候选值，避免汇总后的字段丢失筛选依据。
export function boardFields(items) {
  const fields = new Map();
  for (const { dataset } of items) {
    for (const field of fieldsFor(dataset)) {
      if (!fields.has(field.key)) fields.set(field.key, {
        key: field.key,
        type: field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text',
        values: [],
        seen: new Set(),
      });
      const entry = fields.get(field.key);
      for (const row of dataset.rows) {
        const value = row[field.key];
        if (entry.values.length >= 100) break;
        if (!['string', 'number'].includes(typeof value) || isMissing(value) || entry.seen.has(value)) continue;
        entry.seen.add(value);
        entry.values.push(value);
      }
    }
  }
  return [...fields.values()].map(({ seen, ...field }) => field);
}

export function viewForCard(item, globalFilter = null, intersectionFilters = []) {
  const original = item.view || defaultView(item.dataset);
  validateView(item.dataset, original);
  const globalFilters = Array.isArray(globalFilter) ? globalFilter : globalFilter ? [globalFilter] : [];
  if (!globalFilters.length && !intersectionFilters.length) return { view: original, applicable: true };
  const fields = new Set(fieldsFor(item.dataset).map(field => field.key));
  if ([...globalFilters, ...intersectionFilters].some(filter => !fields.has(filter.field))) {
    return { view: original, applicable: false };
  }
  const replacedFields = new Set(globalFilters.map(filter => filter.field));
  const filters = [
    ...(original.filters || []).filter(filter => !replacedFields.has(filter.field)),
    ...globalFilters,
    ...intersectionFilters,
  ];
  const validated = validateView(item.dataset, { ...original, filters });
  return { view: { ...original, ...validated }, applicable: true };
}

export function buildBoardCard(item, globalFilter = null, intersectionFilters = []) {
  const { view, applicable } = viewForCard(item, globalFilter, intersectionFilters);
  const analyzed = buildView(item.dataset, view);
  const key = item.metricKey ?? (typeof item.metric === 'string' ? item.metric : item.metric?.key);
  const metric = analyzed.metrics.find(candidate => candidate.key === key) || analyzed.metrics[0];
  const data = item.sort ? {
    ...analyzed,
    rows: [...analyzed.rows].sort((a, b) => {
      const left = a[metric.key], right = b[metric.key];
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return right - left;
    }),
  } : analyzed;
  return {
    data,
    metric,
    stats: summarize(data, metric.key),
    applicable,
    sourceRows: filterSource(item.dataset, view).rows.length,
    availability: chartAvailability(data, metric.key, item.chart),
  };
}

export function moveBoardItem(items, id, targetIndex) {
  const origin = items.findIndex(item => item.id === id);
  if (origin < 0) return items;
  const requested = Number(targetIndex);
  const target = Number.isNaN(requested) ? origin : Math.max(0, Math.min(items.length - 1, Math.trunc(requested)));
  const reordered = [...items];
  const [item] = reordered.splice(origin, 1);
  reordered.splice(target, 0, item);
  return reordered;
}

export function datasetQuality(dataset) {
  const fields = [...new Set(fieldsFor(dataset).map(field => field.key))];
  // 仅当名称完全符合导入器生成的唯一序号时，才忽略这个显示标签。
  const generatedNames = !dataset.dimensions?.length && dataset.rows.length > 0
    && dataset.rows.every(row => /^记录\s+\d+$/.test(row.name))
    && new Set(dataset.rows.map(row => row.name)).size === dataset.rows.length;
  const sourceFields = generatedNames ? fields.filter(key => key !== 'name') : fields;
  let missingCells = 0;
  let duplicateRows = 0;
  const seen = new Set();
  for (const row of dataset.rows) {
    missingCells += fields.filter(key => isMissing(row[key])).length;
    const signature = JSON.stringify(sourceFields.map(key => [typeof row[key], row[key]]));
    if (seen.has(signature)) duplicateRows++;
    seen.add(signature);
  }
  return { rows: dataset.rows.length, fields: fields.length, missingCells, duplicateRows };
}
