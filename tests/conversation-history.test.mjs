import test from 'node:test';
import assert from 'node:assert/strict';
import {questionHistoryFor} from '../src/conversationHistory.mjs';

test('完整用户消息独立于可见聊天，保留早期与重复关注点',()=>{
 const questionHistory=Array.from({length:125},(_,i)=>`第${i+1}次分析请求`);
 assert.deepEqual(questionHistoryFor({questionHistory,messages:[{role:'user',text:'最近问题'}]}),questionHistory);
 assert.deepEqual(questionHistoryFor({questionHistory:[],messages:[{role:'user',text:'旧问题'}]}),[]);
});
test('旧记录从现存用户消息迁移，完整保留长问题，不把助手文字当用户意图',()=>{
 const text='分析这份记录'.repeat(1000);
 assert.deepEqual(questionHistoryFor({messages:[{role:'assistant',text:'旧结论'},{role:'user',text},{role:'user',text:'比较变化'}]}),[text,'比较变化']);
});
test('历史格式错误或超过存储预算时明确拒绝，不静默截断',()=>{
 assert.throws(()=>questionHistoryFor({questionHistory:[{}]}));
 assert.throws(()=>questionHistoryFor({questionHistory:['a'.repeat(12001)]}));
 assert.throws(()=>questionHistoryFor({questionHistory:Array(200).fill('a'.repeat(12000))}));
});
