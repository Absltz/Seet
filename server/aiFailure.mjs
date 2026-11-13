import {providerName,textModel} from './provider.mjs';

// Only expose known categories and application-authored messages, never SDK
// request bodies, headers, credentials, or raw upstream error messages.
export function aiFailure(error,{aborted=false,fallback='模型调用未完成，请稍后重试。'}={}) {
 if(aborted)return {code:'interrupted',error:'任务已停止或超时，可重试；原始数据已保留。'};
 const status=Number(error?.statusCode||error?.status),provider=providerName();
 if(status===401)return {code:'authentication',error:`${provider}密钥认证失败，请检查服务端密钥是否有效。`};
 if(status===403)return {code:'model_permission',error:`${provider}拒绝调用 ${error?.model||textModel()}：当前密钥或业务空间未获该模型权限，请在平台核对模型开通及授权。`};
 if(status===402)return {code:'quota',error:`${provider}账户额度不足，请检查平台余额与用量限制。`};
 if(status===429)return {code:'rate_limit',error:`${provider}请求频率或额度达到限制，请稍后重试。`};
 return {code:'provider_error',error:error?.publicMessage||fallback};
}
