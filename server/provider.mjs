// 每次读取运行配置，测试与独立副本不会共享供应商状态。
export function textModel(){return process.env.AI_MODEL||'qwen3.8-flash';}
export function textModels(){return [...new Set([textModel(),...(isQwen()?(process.env.AI_FALLBACK_MODELS??'qwen3.7-flash,qwen3.8-max').split(',').map(m=>m.trim()).filter(Boolean):[])])];}
export function isQwen(){return textModel().startsWith('mimo-')?false:process.env.AI_PROVIDER==='qwen'||textModel().startsWith('qwen');}
export function providerName(){return isQwen()?'千问':'MiMo';}
export function textBaseUrl(){return (process.env.AI_BASE_URL||(isQwen()?'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1':'https://api.xiaomimimo.com/v1')).replace(/\/$/,'');}
export function completionOptions(thinking='disabled',maxTokens=8192){
 return isQwen()?{enable_thinking:thinking==='enabled',...(thinking==='enabled'?{thinking_budget:2048}:{}),max_tokens:maxTokens}:{thinking:{type:thinking},max_completion_tokens:maxTokens};
}
export function asrModel(){return process.env.AI_ASR_MODEL||(isQwen()?'qwen-audio-3.1-asr-flash':'mimo-v2.5-asr');}
export function nativeQwenAsr(){return /^qwen-audio-3\.[01]-asr-flash$/.test(asrModel());}
export function asrBaseUrl(){return (process.env.AI_ASR_BASE_URL||'https://maas.qianwenaiapi.com/api/v1').replace(/\/$/,'');}
