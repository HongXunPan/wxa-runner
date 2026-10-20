/**
 * 普通分包的本地就绪协议。
 *
 * AppBuilder 已预注册所有分包模块，静态资源也由开发服务器直接提供，因此这里不下载文件，
 * 只按基础库协议交回任务 ID，再异步通知进度与完成。未知包明确失败，不假装加载成功。
 */

import { ApiHandler, fail, ok } from './registry';

export interface SubpackageApiOptions {
  subPackages: ReadonlyArray<{ root: string; name?: string }>;
  emit: (event: string, data: Record<string, unknown>) => void;
}

export function createSubpackageApis(options: SubpackageApiOptions): Record<string, ApiHandler> {
  const names = new Set(['__APP__']);
  for (const pkg of options.subPackages) {
    names.add(normalizeName(pkg.root));
    if (pkg.name) names.add(normalizeName(pkg.name));
  }
  let taskSeq = 0;

  const createLoadSubPackageTask: ApiHandler = (args, { api }) => {
    const moduleName = args.moduleName;
    if (typeof moduleName !== 'string' || !moduleName || !names.has(normalizeName(moduleName))) {
      return fail(api, 'module not found');
    }

    const loadTaskId = String(++taskSeq);
    // 先让基础库登记任务、业务方绑定进度监听，之后再派发事件，与网络任务的时序一致。
    setTimeout(() => {
      const event = { taskId: loadTaskId, moduleName };
      options.emit('onLoadSubPackageTaskStateChange', {
        ...event, state: 'progressUpdate', progress: 100,
        // 没有网络下载，不伪造传输字节数。
        totalBytesWritten: 0, totalBytesExpectedToWrite: 0
      });
      options.emit('onLoadSubPackageTaskStateChange', { ...event, state: 'success' });
    }, 0);
    return ok(api, { loadTaskId });
  };

  return {
    createLoadSubPackageTask,
    // 事件已由桥接广播，具体监听与回调由基础库管理，无需另建一套订阅状态。
    listenLoadSubPackageTaskStateChange: (_args, { api }) => ok(api)
  };
}

/** 基础库通常传 /root/；同时接受配置中的 root 与 name，不放宽到任意子路径。 */
function normalizeName(name: string): string {
  return name.replace(/^\.?\//, '').replace(/\/$/, '');
}
