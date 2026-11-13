export function createWorkbenchCoreSession(create) {
  let runtime = null, initializing = null, current = null, closed = false;
  const attach = () => {
    if (current) runtime.attachCore(current.host, current.options);
    else runtime.suspendCore();
  };
  function connect() {
    if (runtime?.isCoreAvailable?.() === false) {
      runtime.dispose();
      runtime = null;
    }
    if (runtime) {
      attach();
      return Promise.resolve();
    }
    // 合并同一轮挂载请求；StrictMode 的试挂载结束后才申请 GPU 资源。
    if (!initializing) initializing = Promise.resolve().then(async () => {
      let request, value;
      do {
        if (closed || !current) return;
        request = current;
        value = await create(request.host, request.options);
        // 模块尚未加载完就快速切页时，旧 host 可能已经卸载；继续服务新标题。
      } while (!value && !closed && current && current !== request);
      return value;
    }).then(value => {
      if (!value) return;
      if (closed) { value.dispose(); return; }
      runtime = value;
      attach();
    }).finally(() => { initializing = null; });
    return initializing;
  }
  return {
    acquire(host, options) {
      if (closed) throw new Error('工作区三维会话已关闭');
      const lease = { host, options };
      current = lease;
      return {
        ready: connect(),
        release() {
          if (current !== lease) return;
          current = null;
          runtime?.suspendCore();
        },
      };
    },
    dispose() {
      if (closed) return;
      closed = true;
      current = null;
      runtime?.dispose();
      runtime = null;
    },
  };
}
