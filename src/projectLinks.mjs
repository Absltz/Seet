// 旧版没有来源编号时，仅完整字段与完整内容相同才可关联，不使用标题猜测。
export function projectContent(value,raw=false) {
 try{
  const columns=raw?value.headers.map(key=>{
   const match=String(key).match(/^(.*)[（(]([^（）()]+)[）)]$/);
   return {original:key,key:match?match[1].trim():String(key).trim(),unit:match?match[2].trim():''};
  }):(value.dimensions?.length?value.dimensions.map(d=>({key:d.key,original:d.key,unit:''})):[{key:'name',original:'name',unit:''}]).concat(value.metrics.map(m=>({key:m.key,original:m.key,unit:m.unit||''})));
  if(!Array.isArray(columns)||!Array.isArray(value.rows))return null;
  const fields=columns.map((field,index)=>({...field,index}));
  if(new Set(fields.map(f=>f.key)).size!==fields.length)return null;
  fields.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const rows=value.rows.map(row=>fields.map(field=>{const cell=raw?row[field.index]:row[field.original];return cell==null?null:String(cell);}));
  if(!rows.some(row=>row.some(cell=>cell!==null&&cell!=='')))return null;
  return JSON.stringify([fields.map(f=>[f.key,f.unit]),rows]);
 }catch{return null;}
}
