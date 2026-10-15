/**
 * Playwright fixture 启动开发服务器的参数：路径都相对 Playwright 配置文件所在目录
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { devServerOptions } from '../../packages/playwright/src/server';

const CONFIG_DIR = path.resolve('/repo/e2e');

describe('fixture 的开发服务器参数', () => {
  it('项目目录和 setup 等路径参数都相对配置文件所在目录，而不是运行命令的目录', () => {
    const options = devServerOptions(CONFIG_DIR, '../mp', { setup: '../mp/wxa.setup.test.ts', baseLibCacheDir: '.cache', baseLibVersion: '3.7.0' });

    expect(options).toMatchObject({
      projectPath: path.resolve('/repo/mp'),
      setup: path.resolve('/repo/mp/wxa.setup.test.ts'),
      baseLibCacheDir: path.resolve('/repo/e2e/.cache'),
      baseLibVersion: '3.7.0',
      port: 0,
      watch: false
    });
  });

  it('不使用 setup、绝对路径和未指定的参数保持原样', () => {
    const options = devServerOptions(CONFIG_DIR, path.resolve('/abs/mp'), { setup: false });

    expect(options.projectPath).toBe(path.resolve('/abs/mp'));
    expect(options.setup).toBe(false);
    expect(options.baseLibCacheDir).toBeUndefined();
  });
});
