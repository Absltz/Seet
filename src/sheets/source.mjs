import {projectContent} from '../projectLinks.mjs';
export function findSourceSheet(items,dataset) {
 if(dataset.sourceSheetId)return items.find(item=>item.id===dataset.sourceSheetId&&(!dataset.projectId||item.table.projectId===dataset.projectId))||null;
 const content=projectContent(dataset);if(!content)return null;
 const candidates=items.filter(item=>(!dataset.projectId||!item.table.projectId||item.table.projectId===dataset.projectId)&&projectContent(item.table,true)===content);
 // 旧版本无明确原表编号且存在多个候选时，不猜测使用哪份原表。
 return candidates.length===1?candidates[0]:null;
}
