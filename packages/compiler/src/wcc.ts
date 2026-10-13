/**
 * WXML 编译（wcc）
 *
 * 所有 wxml/wxs 一次性编译成一个 $gwx 函数，模板 import/include 和 wxs 引用由 wcc 自己解析。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCompiler } from './exec';
import { findCompilerBinaries } from './locate';

export interface ComponentTags {
  /** 页面或组件路径，不带扩展名，如 "pages/index/index" */
  path: string;
  /** 该 wxml 中属于自定义组件（含抽象节点）的标签名 */
  tags: string[];
}

export interface WxmlCompileOptions {
  /** 小程序根目录 */
  cwd: string;
  /** 相对 cwd 的 ./ 开头路径，包含 .wxml 和 .wxs */
  files: string[];
  components: ComponentTags[];
  /**
   * true：逻辑层使用的裁剪版（-xc），只保留组件结构信息；
   * false：渲染层使用的完整版（-cc）
   */
  cut: boolean;
  genfuncName?: string;
}

// Windows 命令行长度上限约 32K，超出时改用配置文件传参（开发者工具同样如此）
const MAX_INLINE_ARGS_LENGTH = 30000;

export async function compileWxml(options: WxmlCompileOptions): Promise<string> {
  const { wcc } = findCompilerBinaries();
  const split = `>_<${Date.now() % 10000}`;

  const config: Array<string | number> = [options.components.length];
  for (const component of options.components) {
    config.push(`./${component.path}.wxml`, component.tags.length, ...component.tags);
  }

  const args = ['-d', '--split', split, options.cut ? '-xc' : '-cc', config.join(split)];
  if (options.files.some(file => file.endsWith('.wxs'))) {
    args.unshift('-ds');
  }
  args.push(...options.files, '-gn', options.genfuncName || '$gwx');

  if (args.join(' ').length <= MAX_INLINE_ARGS_LENGTH) {
    return runCompiler(wcc, args, options.cwd);
  }

  const configFile = path.join(os.tmpdir(), `wxa-runner-wcc-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(configFile, args.join('\n'));
  try {
    return await runCompiler(wcc, ['--config-path', configFile], options.cwd);
  } finally {
    fs.rmSync(configFile, { force: true });
  }
}
