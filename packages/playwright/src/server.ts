import path from 'path';
import type { DevServerOptions } from '@open-wxa/wxa-runner-core';

/** 开发服务器的其余参数，如 baseLibVersion、device、setup */
export type WxaServerOptions = Omit<DevServerOptions, 'projectPath' | 'port' | 'host' | 'watch' | 'runtimeDir' | 'logger'>;

/**
 * fixture 启动开发服务器的参数。路径都相对 Playwright 配置文件所在目录，
 * 与运行命令的目录无关：npx playwright test -c e2e 和在 e2e 目录里运行，结果一样
 */
export function devServerOptions(configDir: string, project: string, options: WxaServerOptions): DevServerOptions {
  const resolve = (file: string) => path.resolve(configDir, file);
  return {
    ...options,
    projectPath: resolve(project),
    setup: typeof options.setup === 'string' ? resolve(options.setup) : options.setup,
    baseLibCacheDir: options.baseLibCacheDir && resolve(options.baseLibCacheDir),
    port: 0,
    watch: false,
    // 编译完成之类的日志每个 worker 都打一遍，只留警告和错误
    logger: { log: () => undefined, warn: console.warn, error: console.error }
  };
}
