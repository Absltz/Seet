import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/browser';
import {tableFromMatrix,validateRawTable} from '../rawTable.mjs';
export async function readSheetFile(file) {
 if(file.size>12*1024*1024)throw new Error('文件超过 12 MB，请拆分后导入。');
 const title=file.name.replace(/\.[^.]+$/,'')||'导入表格',source=file.name;
 if(/\.xlsx$/i.test(file.name))return tableFromMatrix(await readXlsxFile(file),title,source);
 const text=(await file.text()).replace(/^\uFEFF/,'');
 if(/\.json$/i.test(file.name)) {
  let data;try{data=JSON.parse(text)}catch{throw new Error('JSON 格式不正确，请检查文件。')}
  if(data&&Array.isArray(data.headers)&&Array.isArray(data.rows))return validateRawTable({...data,title:data.title||title,source});
  if(Array.isArray(data)&&Array.isArray(data[0]))return tableFromMatrix(data,title,source);
  if(Array.isArray(data)&&data.length&&data.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){const headers=[...new Set(data.flatMap(row=>Object.keys(row)))];return tableFromMatrix([headers,...data.map(row=>headers.map(key=>row[key]??null))],title,source)}
  throw new Error('JSON 需为原表对象、二维数组或对象数组。');
 }
 if(!/\.(csv|tsv)$/i.test(file.name))throw new Error('请选择 XLSX、CSV、TSV 或 JSON 文件。');
 const parsed=Papa.parse(text,{delimiter:/\.tsv$/i.test(file.name)?'\t':'',dynamicTyping:false,skipEmptyLines:'greedy'});
 if(parsed.errors.length)throw new Error('文本表格无法完整读取，请检查分隔符与引号。');
 return tableFromMatrix(parsed.data,title,source);
}
