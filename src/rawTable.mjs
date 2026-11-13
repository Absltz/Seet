import { validateDataset, projectMetadata } from './data.mjs';

const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
export function validateRawTable(value) {
  if (!value || !Array.isArray(value.headers) || !value.headers.length || value.headers.length > 56) throw new Error('原表需要 1–56 列表头。');
  const headers = value.headers.map(header => typeof header === 'string' ? header.trim() : '');
  if (headers.some(header => !header || header.length > 60 || unsafe.has(header)) || new Set(headers).size !== headers.length) throw new Error('表头必须唯一、非空，且不能使用不安全字段名。');
  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 50000) throw new Error('原表需要 1–50000 行数据。');
  if (value.rows.length * headers.length > 500000) throw new Error('原表超过 500000 个单元格，请拆分后导入。');
  const rows = value.rows.map(row => {
    if (!Array.isArray(row) || row.length > headers.length) throw new Error('数据行列数超过表头，请检查原表。');
    return headers.map((_, index) => {
      const cell = row[index] ?? null;
      if (typeof cell === 'string' && cell.length <= 2000 || typeof cell === 'number' && Number.isFinite(cell) || cell === null) return cell;
      throw new Error('单元格需要文本、有限数字或空值，文本最多 2000 字符。');
    });
  });
  const table = { title: String(value.title || '未命名表格').trim().slice(0, 80) || '未命名表格', source: String(value.source || '数据表格').slice(0, 300), headers, rows, ...projectMetadata(value) };
  // 原表完整进入上下文；越限明确拒绝，不能悄悄用样本替代全部行。
  if (JSON.stringify(table).length > 1200000) throw new Error('完整原表超过单次 AI 处理上限（1200000 字符），请拆分表格后再分析。');
  return table;
}

export function tableFromMatrix(matrix, title = '导入数据', source = '数据表格') {
  if (!Array.isArray(matrix) || matrix.length < 2 || !Array.isArray(matrix[0])) throw new Error('需要表头和至少一行数据。');
  const width = Math.max(...matrix.map(row => Array.isArray(row) ? row.length : 0));
  if (width > 56) throw new Error('原表最多支持 56 列，请拆分后导入。');
  const used = new Set();
  const headers = Array.from({length:width}, (_, i) => {
    const name = String(matrix[0][i] ?? '').trim() || `列${i + 1}`;
    let unique = name, suffix = 2;
    while (used.has(unique)) unique = `${name}（${suffix++}）`;
    used.add(unique);
    return unique;
  });
  const rows = matrix.slice(1).map(row => {
    if (!Array.isArray(row)) throw new Error('原表数据行格式不正确。');
    return Array.from({length:width}, (_, i) => {
      const cell = row[i];
      if (cell instanceof Date) {const iso=cell.toISOString();return iso.endsWith('T00:00:00.000Z')?iso.slice(0,10):iso;}
      if (typeof cell === 'boolean') return cell ? '是' : '否';
      return cell ?? null;
    });
  });
  return validateRawTable({title, source, headers, rows});
}

export function tableFromDataset(value) {
  const dataset = validateDataset(value);
  const dimensions = dataset.dimensions?.length ? dataset.dimensions : [{key:'name'}];
  return validateRawTable({
    title: dataset.title, source: value.source,
    ...projectMetadata(value),
    headers: [...dimensions.map(field => field.key === 'name' ? '分类' : field.key), ...dataset.metrics.map(field => field.key + (field.unit ? `（${field.unit}）` : ''))],
    rows: dataset.rows.map(row => [...dimensions.map(field => row[field.key]), ...dataset.metrics.map(field => row[field.key])]),
  });
}

export function tableToMatrix(value) {
  const table = validateRawTable(value);
  return [[...table.headers], ...table.rows.map(row => [...row])];
}
