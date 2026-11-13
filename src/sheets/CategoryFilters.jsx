import {useMemo,useState} from 'react';
import {Filter,Search,Sparkles,X} from 'lucide-react';
export default function CategoryFilters({fields,selections,onChange,textQuery,onTextQueryChange,disabled,count,total}) {
 const [fieldKey,setFieldKey]=useState(''),[query,setQuery]=useState('');
 const field=fields.find(item=>item.key===fieldKey)||fields[0];
 const selected=selections[field?.key]||[];
 const matches=useMemo(()=>field?.values.filter(item=>item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))||[],[field,query]);
 const active=fields.filter(item=>selections[item.key]?.length);
 const toggle=token=>{const next=selected.includes(token)?selected.filter(value=>value!==token):[...selected,token];onChange({...selections,[field.key]:next})};
 return <div className="sheet-categories">
  <div className="sheet-category-controls"><span className="sheet-category-label"><Sparkles size={15}/>AI 分类</span>
   {!fields.length?<span className="sheet-category-hint">先在工作台交给 AI 识别，即可按分类筛选</span>:<>
    <label className="sheet-filter-field"><span className="sheet-sr">分类字段</span><select aria-label="分类字段" disabled={disabled} value={field.key} onChange={e=>{setFieldKey(e.target.value);setQuery('')}}>{fields.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    <details className="sheet-category-menu" key={field.key}><summary aria-disabled={disabled}><Filter size={14}/>{selected.length?`已选 ${selected.length} 项`:'选择分类值'}<span>⌄</span></summary><div className="sheet-category-options"><label className="sheet-category-search"><Search size={14}/><input disabled={disabled} aria-label="搜索分类值" placeholder="搜索全部分类值" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="sheet-category-values">{matches.slice(0,150).map(item=><label key={item.token}><input type="checkbox" disabled={disabled} checked={selected.includes(item.token)} onChange={()=>toggle(item.token)}/><span>{item.label}</span><small>{item.count}</small></label>)}{!matches.length&&<p>没有匹配的分类值</p>}</div><footer><span>{matches.length} 个匹配值{matches.length>150?'，请搜索缩小范围':''}</span><button disabled={disabled||!selected.length} onClick={()=>onChange({...selections,[field.key]:[]})}>清除此字段</button></footer></div></details>
   </>}
   <label className="sheet-text-filter"><Search size={15}/><input type="search" disabled={disabled} aria-label="文字筛选" placeholder="输入文字筛选整行" value={textQuery} onChange={e=>onTextQueryChange(e.target.value)}/>{textQuery&&<button type="button" disabled={disabled} aria-label="清除文字筛选" onClick={()=>onTextQueryChange('')}><X size={14}/></button>}</label>
   <span className="sheet-category-count" role="status">{count.toLocaleString()} / {total.toLocaleString()} 行</span>
  </div>
  {(active.length>0||textQuery.trim())&&<div className="sheet-category-chips">{active.map(item=><button disabled={disabled} key={item.key} aria-label={`清除 ${item.label} 筛选`} onClick={()=>onChange({...selections,[item.key]:[]})}><strong>{item.label}</strong><span>{item.values.filter(v=>selections[item.key].includes(v.token)).map(v=>v.label).join('、')||'当前无匹配值'}</span><X size={13}/></button>)}<button disabled={disabled} className="sheet-filter-clear" onClick={()=>{onChange({});onTextQueryChange('')}}>清除全部</button><small>分类与文字同时满足；保存保留完整原表</small></div>}
 </div>;
}
