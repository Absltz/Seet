import Papa from 'papaparse';

export const HISTORY_LIMIT = 40;
export const emptyTable = () => ({title:'未命名表格',source:'手动录入',headers:['字段 1','字段 2','字段 3','字段 4','字段 5','字段 6'],rows:Array.from({length:20},()=>Array(6).fill(null))});
export const makeHistory = table => ({past:[],present:table,future:[]});
export function commitHistory(history,table) {
  if (history.present===table) return history;
  return {past:[...history.past,history.present].slice(-HISTORY_LIMIT),present:table,future:[]};
}
export const undoHistory = h => !h.past.length?h:{past:h.past.slice(0,-1),present:h.past.at(-1),future:[h.present,...h.future].slice(0,HISTORY_LIMIT)};
export const redoHistory = h => !h.future.length?h:{past:[...h.past,h.present].slice(-HISTORY_LIMIT),present:h.future[0],future:h.future.slice(1)};
export function applyPaste(table,start,text) {
  const data=Papa.parse(text.replace(/\r\n/g,'\n'),{delimiter:'\t',skipEmptyLines:false}).data;
  if(data.length>1&&data.at(-1).every(v=>v==='')&&text.endsWith('\n')) data.pop();
  const width=Math.max(table.headers.length,start.col+Math.max(...data.map(row=>row.length)));
  const height=Math.max(table.rows.length,start.row+data.length);
  if(width>56) throw new Error('数据表最多支持 56 列。');
  if(height>50000||width*height>500000) throw new Error('粘贴后超出 50000 行或 500000 单元格上限。');
  if(data.some(r=>r.some(v=>v.length>2000))) throw new Error('单元格最多支持 2000 字符。');
  const headers=Array.from({length:width},(_,i)=>table.headers[i]??`字段 ${i+1}`);
  const rows=Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>table.rows[r]?.[c]??null));
  data.forEach((row,r)=>row.forEach((value,c)=>{rows[start.row+r][start.col+c]=value}));
  return {...table,headers,rows};
}
export function selectionTSV(table,a,b) {
  const r0=Math.min(a.row,b.row),r1=Math.max(a.row,b.row),c0=Math.min(a.col,b.col),c1=Math.max(a.col,b.col);
  return Papa.unparse(table.rows.slice(r0,r1+1).map(row=>row.slice(c0,c1+1).map(v=>v??'')),{delimiter:'\t',newline:'\n'});
}
export function sortColumn(table,column,descending=false) {
  const numeric=table.rows.every(row=>row[column]===null||row[column]===''||typeof row[column]==='number');
  const rows=table.rows.map((row,index)=>({row,index}));
  rows.sort((a,b)=>{
    const x=a.row[column],y=b.row[column],xe=x===null||x==='',ye=y===null||y==='';
    if(xe||ye) return xe===ye?a.index-b.index:xe?1:-1;
    const value=numeric?x-y:String(x).localeCompare(String(y),'zh-CN',{numeric:false});
    return (descending?-value:value)||a.index-b.index;
  });
  return {...table,rows:rows.map(v=>v.row)};
}
export function editedCell(value,previous) {
  return typeof previous==='number'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))?Number(value):value;
}
export const columnLetter = n => {let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};
