import {dimensionsFor} from '../src/analysis.mjs';

// 仅识别“范围 + 列举指令 + 字段名”的全取值语法。字段名之外若还有谓词、
// 具体对象或条件值，就交回条件查询/质量工具；不按任何行业的异常关键词排除。
const enumerationFrame = /^(?:[\s，,。?？！!、:：;；“”"‘’'（）()□]|请问|请|麻烦|帮我|帮忙|告诉我|展示|显示|看看|查看|一下|把|给我|这份|这个|该|当前|数据集|数据|表格|全表|表|记录|筛选后|已筛选|筛选|范围|选中|所选|整个|全量|所有|全部|各个|不同|的|中|里|内|都|分别|完整|去重|后|取值|值|名单|名称|类别|类型|分类|字段|列出来|列出|列举|列|有哪些|有什么|有哪几|包括哪|包含哪|些|个|种|分别是|和|以及|及|与|呢|吗)*$/u;

/** 从真实字段名识别无条件的完整名单请求；条件子集不强制套用全表名单。 */
export function enumerationRequirements(data, request = '') {
  if (!data || !/(?:有哪些|有什么|有哪几|包括哪|包含哪|分别是|列出|列举|全部.{0,12}(?:名单|取值)|所有.{0,12}(?:名单|取值))/.test(request)) return [];
  const fields = [...dimensionsFor(data), ...data.metrics];
  const scope = /(?:全表|全部数据|全量|整个数据集)/.test(request) ? 'all'
    : /(?:当前(?:筛选|范围)|筛选后|已筛选|选中|所选)/.test(request) ? 'current' : 'all';
  const matched = fields.filter(field => request.includes(field.key));
  const frame = [...matched].sort((a,b)=>b.key.length-a.key.length).reduce((text, field)=>text.replaceAll(field.key,'□'),request);
  if (!enumerationFrame.test(frame)) return [];
  // 多字段必须是并列目标；“甲字段的乙字段”或相邻字段仍可能是条件/关系查询。
  if (frame.split('□').slice(1,-1).some(between=>!/[、，,]|和|以及|及|与/.test(between))) return [];
  return matched.filter(field => matched.filter(other => other.key.length > field.key.length)
    .reduce((text, other) => text.replaceAll(other.key,''), request).includes(field.key))
    .map(field => ({field:field.key, scope}));
}

const signature = result => JSON.stringify({field:result.field, scope:result.scope, scopeFilters:result.scopeFilters, filters:result.filters, match:result.match});
const hasNumber = (answer, number) => new RegExp(`(?:^|[^0-9])${number}(?![0-9])`).test(answer);
function mentions(answer, value) {
  const text = String(value), escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${/^[a-z0-9_]/i.test(text)?'(?<![a-z0-9_])':''}${escaped}${/[a-z_]/i.test(text.at(-1))?'(?![a-z0-9_])':/[0-9]/.test(text.at(-1))?'(?![0-9])':''}`, 'i').test(answer);
}

/** 名单的“查全”和“答全”分开验证；原始样本、其他分组及另一范围都不是名单证据。 */
export function enumerationCompletionError({requirements, observations, answer, request, hasCurrentFilters}) {
  for (const requirement of requirements) {
    const matching = observations.filter(result => result.field === requirement.field && result.scope === requirement.scope && result.filters.length === 0);
    if (!matching.length) return `“${requirement.field}”名单尚无${requirement.scope==='all'?'全表':'当前筛选'}去重证据。请调用list_values，field=${requirement.field}、scope=${requirement.scope}；字段示例和query_records原始样本不能证明完整名单。`;
    const last = matching.at(-1), pages = matching.filter(result => signature(result) === signature(last));
    const covered = new Set(), values = new Map();
    for (const page of pages) for (let index=0; index<page.values.length; index++) {
      covered.add(page.offset + index);
      values.set(JSON.stringify(page.values[index].value), page.values[index].value);
    }
    const complete = Array.from({length:last.total},(_,index)=>index).every(index=>covered.has(index));
    const mentioned = [...values.values()].filter(value=>mentions(answer,value)).length;
    const partial = /(?:仅|只).{0,10}(?:展示|列出|列举|返回)|部分(?:名单|取值|分类|编号|对象)|尚未列出/.test(answer);
    if (hasCurrentFilters && !(requirement.scope === 'all' ? /全表|全部数据|全量|整个数据集/.test(answer) : /当前(?:筛选|范围)|筛选后|所选|已筛选/.test(answer))) {
      return `请明确“${requirement.field}”名单的${requirement.scope==='all'?'全表':'当前筛选'}口径，不能把工作台筛选范围和全部数据混用。`;
    }
    if (complete && mentioned === last.total) continue;
    if (last.total <= 50) return `“${requirement.field}”共${last.total}个值，名单仍有遗漏或证据未取全；请用list_values续查后完整列出，不能把少数示例当作全部。`;
    if (!partial || /完整(?:名单|列表)|全部(?:名单|列表)|无遗漏/.test(answer) || !hasNumber(answer,last.total) || !hasNumber(answer,last.total-mentioned)) {
      const nextOffset = Array.from({length:last.total},(_,index)=>index).find(index=>!covered.has(index));
      return `“${requirement.field}”共${last.total}个值，尚未完整列出。请按相同范围分页${nextOffset===undefined?'':`（offset=${nextOffset}）`}；若仅展示部分，答复须明确总数${last.total}、仅列部分及其余${last.total-mentioned}个未列出，不得声称完整。`;
    }
  }
  return null;
}
