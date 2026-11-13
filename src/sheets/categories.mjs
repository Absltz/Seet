import Papa from 'papaparse';
// 分类字段仅使用 AI 已确认的维度；这里负责映射回原列，不推断字段含义。
export const valueToken=value=>JSON.stringify([value===null?'null':typeof value,value]);
export const valueLabel=value=>value===null?'缺失值':value===''?'空文本':String(value);
export function rawCategories(table,dataset) {
 if(!dataset||!table)return [];
 return (dataset.dimensions?.length?dataset.dimensions:[{key:'name',type:'text'}]).flatMap(field=>{
  const declared=dataset.sourceColumns?.find(column=>column.key===field.key);
  let index=-1;
  if(declared){if(table.headers[declared.index]===declared.header)index=declared.index;}
  else {const key=field.key==='name'?'分类':field.key;index=table.headers.indexOf(key);}
  if(index<0)return [];
  const counts=new Map();for(const row of table.rows){const value=row[index],token=valueToken(value);const entry=counts.get(token);if(entry)entry.count++;else counts.set(token,{token,value,label:valueLabel(value),count:1});}
  return [{key:field.key,label:table.headers[index],index,type:field.type,values:[...counts.values()]}];
 });
}
export function filteredIndexes(table,fields,selections={},textQuery='') {
 const active=fields.filter(field=>selections[field.key]?.length).map(field=>({index:field.index,values:new Set(selections[field.key])}));
 const query=textQuery.trim().toLocaleLowerCase();
 const result=[];table.rows.forEach((row,index)=>{
  if(active.every(field=>field.values.has(valueToken(row[field.index])))&&(!query||row.some(value=>value!==null&&String(value).toLocaleLowerCase().includes(query))))result.push(index);
 });return result;
}
export function visibleSelection(table,indexes,anchor,selection) {
 const lo=Math.min(anchor.row,selection.row),hi=Math.max(anchor.row,selection.row),c0=Math.min(anchor.col,selection.col),c1=Math.max(anchor.col,selection.col);
 return Papa.unparse(indexes.filter(index=>index>=lo&&index<=hi).map(index=>table.rows[index].slice(c0,c1+1)),{delimiter:'\t',newline:'\n'});
}
