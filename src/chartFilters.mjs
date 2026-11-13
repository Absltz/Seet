import { dimensionsFor, filterSource, validateView } from './analysis.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const sameCategory = (a, b) => String(a) === String(b);
const fieldLabel = (key) => key === 'name' ? '分类' : key;
const missingError = () => new Error('这个分类包含缺失值，现有筛选条件无法安全区分，请先补全空值。');

// 高亮会逐点调用。只在数据引用变化时重新推断字段，避免每个点扫描整表。
const dimensionCache = new WeakMap();
function cachedDimensions(dataset) {
  const previous = dimensionCache.get(dataset);
  if (previous && previous.rows === dataset.rows && previous.count === dataset.rows.length && previous.dimensions === dataset.dimensions && previous.dimensionCount === dataset.dimensions?.length) return previous.value;
  const value = dimensionsFor(dataset);
  dimensionCache.set(dataset, { rows: dataset.rows, count: dataset.rows.length, dimensions: dataset.dimensions, dimensionCount: dataset.dimensions?.length, value });
  return value;
}

export function chartDimension(dataset, view = {}) {
  const dimensions = cachedDimensions(dataset);
  const dimension = view.groupBy ? dimensions.find(d => d.key === view.groupBy) : dimensions[0];
  if (!dimension) throw new Error('图表选择的字段不存在。');
  return { key: dimension.key, label: fieldLabel(dimension.key), type: dimension.type };
}

function categoryValues(dataset, view, row, dimension) {
  const source = filterSource(dataset, view).rows;
  let values;
  if (!view.groupBy || own(row, dimension.key) && dimension.key !== 'name') {
    values = [row?.[dimension.key]];
  } else {
    // buildView stringifies group names and uses the same label for null and real text.
    values = source.filter(r => String(r[dimension.key] ?? '未填写') === String(row?.name)).map(r => r[dimension.key]);
    if (!values.length) throw new Error('无法在原始数据中找到这个分类。');
  }
  if (values.some(value => value == null)) throw missingError();
  const seen = new Set();
  const unique = values.filter(value => {
    const key = String(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  checkCategories(source, dimension.key, unique);
  return unique;
}

function checkCategories(rows, field, values) {
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error('分类选择需要 1 至 100 项。');
  if (values.some(v => v == null)) throw missingError();
  if (values.some(v => !['string', 'number'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v))) throw new Error('分类值不受支持。');
  // Existing eq/in filters compare String(value); never silently include missing rows.
  if (rows.some(r => r[field] == null && values.some(v => sameCategory(v, r[field])))) throw missingError();
}

function dateParts(value) {
  const text = String(value ?? '');
  const match = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ].*)?)?)?$/);
  if (!match) throw new Error('日期格式无法识别，请使用年、年月或完整日期。');
  const year = Number(match[1]), month = Number(match[2] || 1), day = Number(match[3] || 1);
  const limit = daysInMonth(year, month);
  if (month < 1 || month > 12 || day < 1 || day > limit) throw new Error('日期无效，请检查月份、日期或闰年。');
  return { text, year, month, day, precision: match[3] ? 'day' : match[2] ? 'month' : 'year' };
}

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function dateValue(row, dimension) {
  const value = own(row, dimension.key) ? row[dimension.key] : row?.name;
  if (value == null) throw new Error('缺失日期不能进行图表筛选，请先补全日期。');
  return value;
}

function bucket(value, granularity) {
  const parts = dateParts(value);
  const length = { year: 4, month: 7, day: 10 }[granularity];
  if (!length) throw new Error('日期选择的粒度不受支持。');
  const padded = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return padded.slice(0, length);
}

function rowRange(dataset, view, row) {
  const dimension = chartDimension(dataset, view);
  if (dimension.type !== 'date') throw new Error('只有日期字段支持连续范围选择。');
  const value = dateValue(row, dimension);
  const precision = dateParts(value).precision;
  const granularity = ['day', 'month', 'year'].includes(view.granularity) ? view.granularity : precision;
  const date = bucket(value, granularity);
  return { kind: 'range', field: dimension.key, granularity, start: date, end: date };
}

export function selectionForRow(dataset, view, row, previous = null) {
  const dimension = chartDimension(dataset, view);
  if (dimension.type === 'date') {
    const selection = rowRange(dataset, view, row);
    return previous?.kind === 'range' && previous.field === selection.field && previous.granularity === selection.granularity && previous.start === selection.start && previous.end === selection.end ? null : selection;
  }
  const values = categoryValues(dataset, view, row, dimension);
  const selected = previous?.kind === 'categories' && previous.field === dimension.key ? [...previous.values] : [];
  for (const value of values) {
    const index = selected.findIndex(v => sameCategory(v, value));
    if (index >= 0) selected.splice(index, 1);
    else selected.push(value);
  }
  if (selected.length > 100) throw new Error('最多同时选择 100 个分类，请先取消部分选择。');
  return selected.length ? { kind: 'categories', field: dimension.key, values: selected } : null;
}

export function selectionForRange(dataset, view, firstRow, lastRow) {
  const first = rowRange(dataset, view, firstRow), last = rowRange(dataset, view, lastRow);
  const order = { year: 0, month: 1, day: 2 };
  const granularity = order[first.granularity] < order[last.granularity] ? first.granularity : last.granularity;
  const dates = [bucket(first.start, granularity), bucket(last.end, granularity)].sort();
  return { ...first, granularity, start: dates[0], end: dates[1] };
}

function selectionDimension(dataset, selection) {
  const dimension = cachedDimensions(dataset).find(d => d.key === selection.field);
  if (!dimension) throw new Error('选择的筛选字段不存在。');
  return dimension;
}

function normalizedRange(dataset, selection) {
  const dimension = selectionDimension(dataset, selection);
  if (dimension.type !== 'date') throw new Error('连续范围选择需要日期字段。');
  const start = bucket(selection.start, selection.granularity), end = bucket(selection.end, selection.granularity);
  if (start > end) return { start: end, end: start };
  return { start, end };
}

export function selectionFilters(dataset, view, selection) {
  if (!selection) return [];
  selectionDimension(dataset, selection);
  if (selection.kind === 'categories') {
    checkCategories(filterSource(dataset, view).rows, selection.field, selection.values);
    return [{ field: selection.field, op: 'in', value: [...selection.values] }];
  }
  if (selection.kind !== 'range') throw new Error('图表选择类型不受支持。');
  const { start, end } = normalizedRange(dataset, selection);
  // A year/month-only source may be displayed at a finer granularity. Keep its
  // original prefix at the inclusive lower edge, just as buildView keeps it.
  const lower = filterSource(dataset, view).rows.reduce((boundary, row) => {
    const value = row[selection.field];
    return typeof value === 'string' && /^\d{4}(?:-\d{2})?$/.test(value) && start.startsWith(value) && bucket(value, selection.granularity) === start && value < boundary ? value : boundary;
  }, start);
  const parts = dateParts(end);
  const month = selection.granularity === 'year' ? 12 : parts.month;
  const day = selection.granularity === 'day' ? parts.day : daysInMonth(parts.year, month);
  // 既有日期筛选按字符串比较；无小数的 Z 后缀同时包含最后一秒的两种 ISO 写法。
  const endDate = `${String(parts.year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59Z`;
  return [{ field: selection.field, op: 'gte', value: lower }, { field: selection.field, op: 'lte', value: endDate }];
}

export function mergeChartSelection(dataset, baseView, selection) {
  const base = validateView(dataset, baseView);
  return validateView(dataset, { ...base, filters: [...base.filters, ...selectionFilters(dataset, base, selection)] });
}

export function rowSelected(dataset, view, row, selection) {
  if (!selection) return true;
  const dimension = chartDimension(dataset, view);
  if (selection.field !== dimension.key) return false;
  try {
    if (selection.kind === 'categories') {
      if (!view.groupBy || own(row, dimension.key)) {
        const value = row?.[dimension.key];
        return value != null && selection.values.some(v => sameCategory(v, value));
      }
      // Normal group names can be compared directly; only the missing-value
      // label needs source recovery. This keeps chart highlighting linear.
      if (row?.name !== '未填写') return selection.values.some(v => sameCategory(v, row?.name));
      return categoryValues(dataset, view, row, dimension).some(value => selection.values.some(v => sameCategory(v, value)));
    }
    if (selection.kind !== 'range') return false;
    const date = bucket(dateValue(row, dimension), selection.granularity);
    const { start, end } = normalizedRange(dataset, selection);
    return date >= start && date <= end;
  } catch {
    return false;
  }
}

export function selectionLabel(selection) {
  if (!selection) return '';
  const label = fieldLabel(selection.field);
  if (selection.kind === 'categories') return `${label}：${selection.values.map(String).join('、')}`;
  return `${label}：${selection.start}${selection.start === selection.end ? '' : ` 至 ${selection.end}`}`;
}
