import test from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
const load=()=>import('../src/sheets/categories.mjs');
const table={title:'课程',headers:['学生编号','所属班','科目','成绩（分）'],rows:[['2025001','一班','高数',0],['2025002','二班','英语',90],['2025003','一班',null,80],['2025004','一班','高数',85]]};
const dataset={title:'课程',dimensions:[{key:'学生编号',type:'text'},{key:'所属班',type:'text'},{key:'科目',type:'text'}],metrics:[{key:'成绩',unit:'分'}],rows:table.rows.map(r=>({name:r[0],学生编号:r[0],所属班:r[1],科目:r[2],成绩:r[3]})),sourceColumns:[{index:0,header:'学生编号',key:'学生编号'},{index:1,header:'所属班',key:'所属班'},{index:2,header:'科目',key:'科目'},{index:3,header:'成绩（分）',key:'成绩'}]};
test('分类来自 AI 维度及原列映射，不把数值成绩当作分类',async()=>{const {rawCategories}=await load();const fields=rawCategories(table,dataset);assert.deepEqual(fields.map(f=>f.key),['学生编号','所属班','科目']);assert.equal(fields[1].index,1);assert.equal(rawCategories(table,null).length,0);assert.equal(rawCategories({...table,headers:['编号已改名',...table.headers.slice(1)]},dataset).some(f=>f.key==='学生编号'),false)});
test('分类组合使用 AND，单字段多选使用 OR，缺失和零值分别保留',async()=>{const {rawCategories,filteredIndexes,valueToken}=await load();const fields=rawCategories(table,dataset),before=structuredClone(table);assert.deepEqual(filteredIndexes(table,fields,{所属班:[valueToken('一班')],科目:[valueToken('高数'),valueToken(null)]}),[0,2,3]);assert.deepEqual(filteredIndexes(table,fields,{科目:[valueToken(null)]}),[2]);assert.deepEqual(filteredIndexes(table,fields,{科目:[valueToken('不存在')]}),[]);assert.notEqual(valueToken(0),valueToken(null));assert.notEqual(valueToken('0'),valueToken(0));assert.deepEqual(table,before)});
test('筛选后的复制只复制可见行，保持原单元格序号和前导零',async()=>{const {visibleSelection}=await load();assert.equal(visibleSelection(table,[0,3],{row:0,col:0},{row:3,col:3}),'2025001\t一班\t高数\t0\n2025004\t一班\t高数\t85')});
test('复制包含制表符、引号和换行的单元格后，不拆成错误行列',async()=>{const {visibleSelection}=await load();const source={headers:['A','B'],rows:[['甲\t乙','line\nnext'],['隐藏','内容'],['"引号"','末行']]};const text=visibleSelection(source,[0,2],{row:0,col:0},{row:2,col:1});assert.deepEqual(Papa.parse(text,{delimiter:'\t',newline:'\n'}).data,[source.rows[0],source.rows[2]])});

test('文字筛选匹配整行并与分类取交集，保留原行号和原表',async()=>{
 const {filteredIndexes,rawCategories,valueToken}=await load(),fields=rawCategories(table,dataset),before=structuredClone(table);
 assert.deepEqual(filteredIndexes(table,fields,{},' 高数 '),[0,3]);
 assert.deepEqual(filteredIndexes(table,fields,{所属班:[valueToken('一班')]},'英语'),[]);
 assert.deepEqual(filteredIndexes(table,fields,{},'2025002'),[1]);
 assert.deepEqual(filteredIndexes(table,fields,{},'85'),[3]);
 assert.deepEqual(filteredIndexes(table,fields,{},'  '),[0,1,2,3]);
 assert.deepEqual(table,before);
});

test('文字筛选忽略大小写，零值可检索且缺失不误匹配为 null',async()=>{
 const {filteredIndexes}=await load(),source={headers:['编号','数量'],rows:[['H007',0],['H008',null],['其他',null]]};
 assert.deepEqual(filteredIndexes(source,[],{},'h007'),[0]);
 assert.deepEqual(filteredIndexes(source,[],{},'0'),[0,1]);
 assert.deepEqual(filteredIndexes(source,[],{},'null'),[]);
});
