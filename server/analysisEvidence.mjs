import {summarize} from '../src/data.mjs';
import {buildView, defaultView, dimensionsFor, filterSource, qualityReport, validateView} from '../src/analysis.mjs';

const missing = value => value == null || typeof value === 'string' && !value.trim();
const fieldsFor = data => [...dimensionsFor(data).map(field => field.key), ...data.metrics.map(field => field.key)];

function scopedRecords(data, currentView, scope) {
  if (!['all', 'current'].includes(scope)) throw new Error('查询范围必须是全表或当前筛选。');
  const filters = scope === 'current' ? validateView(data, currentView || defaultView(data)).filters : [];
  const included = new Set(filterSource(data, {filters}).rows);
  return {scope, scopeFilters: filters, sourceRows: data.rows.length,
    records: data.rows.flatMap((values, index) => included.has(values) ? [{recordNumber:index + 1, values}] : [])};
}

function checkedFields(data, fields, fallback) {
  const valid = new Set(['name', ...fieldsFor(data)]);
  const chosen = fields ?? fallback;
  if (!Array.isArray(chosen) || !chosen.length || chosen.length > 57 || chosen.some(field => !valid.has(field))) {
    throw new Error(`查询字段不存在或选择为空；可用字段：${[...valid].join('、')}。recordNumber由工具自动返回，不放入columns。`);
  }
  return [...new Set(chosen)];
}

function pageOptions({offset = 0, limit = 30}) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('查询起点必须是非负整数，每次返回 1–50 条。');
  }
  return {offset, limit};
}

function pageResult(records, offset, limit) {
  const returned = records.slice(offset, offset + limit), hasMore = offset + returned.length < records.length;
  return {total:records.length, offset, returned:returned.length, hasMore, nextOffset:hasMore ? offset + returned.length : null, records:returned};
}

function checkConditions(data, filters, match) {
  if (!Array.isArray(filters) || filters.length > 8 || !['all','any'].includes(match)) throw new Error('查询条件不受支持。');
  for (const filter of filters) {
    checkedFields(data, [filter.field], []);
    if (!['eq','in','contains','gte','lte','is_missing','not_missing'].includes(filter.op)) throw new Error('查询操作不受支持。');
    if (['is_missing','not_missing'].includes(filter.op)) continue;
    const values = filter.op === 'in' ? filter.value : [filter.value];
    if (!Array.isArray(values) || !values.length || values.length > 100 || values.some(value =>
      !['string','number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('查询条件需要完整的值，多选请传数组。');
    }
  }
}

function matches(row, filter) {
  const value = row[filter.field];
  if (filter.op === 'is_missing') return missing(value);
  if (filter.op === 'not_missing') return !missing(value);
  if (missing(value)) return false;
  if (filter.op === 'eq') return String(value) === String(filter.value);
  if (filter.op === 'in') return filter.value.some(candidate => String(candidate) === String(value));
  if (filter.op === 'contains') return String(value).includes(String(filter.value));
  if (filter.op === 'gte') return value >= filter.value;
  return value <= filter.value;
}

/** 先扫描整个查询范围再按去重值分页，不会把原始记录前几行当作分类全集。 */
export function distinctValues(data, currentView, options = {}) {
  const {field, scope = 'all', filters = [], match = 'all'} = options;
  checkedFields(data, [field], []);
  checkConditions(data, filters, match);
  const {offset, limit} = pageOptions({...options, limit:options.limit ?? 50});
  const context = scopedRecords(data, currentView, scope), counts = new Map();
  let matchedRows = 0, missingRows = 0;
  for (const {values} of context.records) {
    if (filters.length && !(match === 'any' ? filters.some(filter => matches(values, filter)) : filters.every(filter => matches(values, filter)))) continue;
    matchedRows++;
    const value = values[field];
    if (missing(value)) { missingRows++; continue; }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const values = [...counts].map(([value, count]) => ({value, count})), page = pageResult(values, offset, limit);
  return {ok:true, field, scope, scopeFilters:context.scopeFilters, filters, match,
    sourceRows:data.rows.length, scopedRows:context.records.length, matchedRows, missingRows,
    total:page.total, offset:page.offset, returned:page.returned, hasMore:page.hasMore, nextOffset:page.nextOffset,
    values:page.records,
    notes:'已扫描整个指定范围并去重，count是该值对应的原始记录数（不依赖数值指标是否为空）；空值/空白文本不算分类，另记missingRows。values按首次出现顺序分页，hasMore=true仅为部分名单，按nextOffset续查；分页参数和范围必须一致。仅查询，未改变图表或筛选。',
    summary:`已扫描 ${matchedRows} 条记录，“${field}”共有 ${values.length} 个非缺失去重值，本次返回 ${page.returned} 个${page.hasMore?'，其余可继续分页':''}，未改变当前图表`};
}

/** 只读查询，不为回答问题而修改工作台的图表与筛选。recordNumber 是导入后的原始记录序号。 */
export function queryRecords(data, currentView, options = {}) {
  const {scope = 'all', filters = [], match = 'all', issue = 'all'} = options;
  const {offset, limit} = pageOptions(options), context = scopedRecords(data, currentView, scope);
  const columns = checkedFields(data, options.columns, ['name', ...fieldsFor(data)]);
  const issueFields = checkedFields(data, options.issueFields, fieldsFor(data));
  if (!['all','missing','negative','zero','duplicate'].includes(issue)) throw new Error('记录查询类型不受支持。');
  checkConditions(data, filters, match);
  const numericFields = new Set(data.metrics.map(metric => metric.key)), seen = new Map();
  const records = [];
  for (const record of context.records) {
    const key = JSON.stringify(record.values), duplicateOf = seen.get(key);
    if (duplicateOf === undefined) seen.set(key, record.recordNumber);
    const affected = issueFields.filter(field => issue === 'missing' ? missing(record.values[field])
      : issue === 'negative' ? numericFields.has(field) && record.values[field] !== null && record.values[field] < 0
      : issue === 'zero' ? numericFields.has(field) && record.values[field] === 0 : false);
    if (issue === 'duplicate' ? duplicateOf === undefined : issue !== 'all' && !affected.length) continue;
    if (filters.length && !(match === 'any' ? filters.some(filter => matches(record.values, filter)) : filters.every(filter => matches(record.values, filter)))) continue;
    records.push({recordNumber:record.recordNumber,
      values:Object.fromEntries(columns.map(field => [field, record.values[field]])),
      ...(affected.length ? {fields:affected} : {}), ...(duplicateOf === undefined ? {} : {duplicateOf})});
  }
  return {ok:true, scope, scopeFilters:context.scopeFilters, sourceRows:context.sourceRows, scopedRows:context.records.length,
    filters, match, issue, columns, ...pageResult(records, offset, limit),
    notes:'recordNumber 为导入后的原始记录序号，并非 Excel 物理行号。空值与空白文本属于缺失；零值有效。仅查询，未改变图表或筛选。',
    summary:`已查询 ${records.length} 条原始记录，本次返回 ${Math.min(limit, Math.max(0, records.length-offset))} 条${offset+limit<records.length?'，其余可继续分页':''}`};
}

/** 计数和具体对象由同一批原始记录计算；样本截断必须向模型说明。 */
export function qualityEvidence(data, currentView, {scope = 'all'} = {}) {
  const context = scopedRecords(data, currentView, scope), rows = context.records.map(record => record.values);
  const source = {...data, rows}, report = qualityReport(source), fields = fieldsFor(data);
  const numerical = data.metrics.map(metric => metric.key), seen = new Map(), duplicates = [];
  const issues = {missing:[], negative:[], zero:[]}, missingCounts = new Map(fields.map(field => [field,0]));
  for (const record of context.records) {
    const key = JSON.stringify(record.values);
    if (seen.has(key)) duplicates.push({...record, duplicateOf:seen.get(key)});
    else seen.set(key, record.recordNumber);
    const absent = fields.filter(field => missing(record.values[field]));
    absent.forEach(field => missingCounts.set(field, missingCounts.get(field) + 1));
    if (absent.length) issues.missing.push({...record, fields:absent});
    const negative = numerical.filter(field => record.values[field] !== null && record.values[field] < 0);
    if (negative.length) issues.negative.push({...record, fields:negative});
    const zero = numerical.filter(field => record.values[field] === 0);
    if (zero.length) issues.zero.push({...record, fields:zero});
  }
  const describe = records => ({rowCount:records.length, cellCount:records.reduce((count, record) => count + record.fields.length, 0),
    examples:records.slice(0,20), hasMore:records.length>20, nextOffset:records.length>20?20:null});
  return {ok:true, ...report, scope, scopeFilters:context.scopeFilters, sourceRows:data.rows.length,
    metrics:report.metrics.map(metric => ({...metric, zero:rows.filter(row => row[metric.key] === 0).length})),
    dimensions:dimensionsFor(data).map(field => ({...field, missing:missingCounts.get(field.key)})),
    missing:{...describe(issues.missing), byField:[...missingCounts].filter(([,count]) => count>0).map(([field,count]) =>
      ({field,count,percentage:Number((100*count/(rows.length||1)).toFixed(2))}))},
    negative:describe(issues.negative), zero:describe(issues.zero),
    duplicates:{extraRows:duplicates.length, examples:duplicates.slice(0,20), hasMore:duplicates.length>20, nextOffset:duplicates.length>20?20:null},
    notes:'空值及空白文本才计为缺失，零值仍参与统计。负值和零值不一定错误，应结合原始状态解释；状态文本不能自动等同于缺失。样本只展示前20条，hasMore=true须用query_records补查，不得把样本当全集。记录序号不是Excel物理行号。本次仅检查，不删除、填补或修改数据。',
    summary:`已检查 ${rows.length} 条原始记录：${issues.missing.length} 条涉及缺失，${report.duplicateRows} 条完全重复；已提供字段及具体记录明细，未修改数据`};
}

/** 对比多个口径无需反复 configure_view；原始筛选范围与补充条件分别返回。 */
export function statisticsEvidence(data, currentView, options = {}) {
  const scope = options.scope || 'current', context = scopedRecords(data, currentView, scope);
  const {offset, limit} = pageOptions(options), key = options.metric || data.metrics[0].key;
  if (!data.metrics.some(metric => metric.key === key)) throw new Error('指标不存在，请先读取真实字段名。');
  const overrides = Object.fromEntries(['groupBy','granularity','aggregation','filters'].filter(field => options[field] !== undefined).map(field => [field,options[field]]));
  const base = currentView || defaultView(data);
  const view = validateView(data,{...base,filters:[],...overrides,
    ...(options.groupBy !== undefined && options.groupBy !== base.groupBy && options.granularity === undefined ? {granularity:'none'} : {})});
  const source = {...data, rows:context.records.map(record => record.values)}, result = buildView(source, view);
  const page = pageResult(result.rows, offset, limit);
  return {ok:true, scope, scopeFilters:context.scopeFilters, sourceRows:data.rows.length,
    matchedRows:filterSource(source,view).rows.length, metric:key, unit:result.metrics.find(metric => metric.key===key).unit, view,
    statistics:summarize(result,key), rows:result.rows.length, values:page.records,
    offset:page.offset, returned:page.returned, hasMore:page.hasMore, nextOffset:page.nextOffset,
    notes:'数值由程序按指定范围及口径计算；当前筛选与补充筛选同时生效。仅查询，未改变图表。hasMore=true时仅展示部分分组，可继续分页。',
    summary:`已计算 ${result.rows.length} 组${key}统计，未改变当前图表`};
}
