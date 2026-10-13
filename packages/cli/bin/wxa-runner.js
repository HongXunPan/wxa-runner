#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const { spawn } = require('child_process');

const program = new Command();

program
  .name('wxa-runner')
  .description('在浏览器中用官方基础库运行微信小程序')
  .version('0.1.0');

program
  .command('dev <project-path>')
  .description('启动开发服务器')
  .option('-p, --port <port>', '端口号', '3000')
  .option('--host <host>', '监听地址', 'localhost')
  .option('-b, --baselib <version>', '基础库版本（默认使用本机已安装的最新兼容版本）')
  .option('--no-watch', '不监听文件变化')
  .option('-o, --open', '启动后打开浏览器')
  .action(async (projectPath, options) => {
    const { DevServer } = require('@open-wxa/wxa-runner-core');

    try {
      const server = new DevServer({
        projectPath: path.resolve(process.cwd(), projectPath),
        port: parseInt(options.port, 10),
        host: options.host,
        baseLibVersion: options.baselib,
        watch: options.watch
      });
      const url = await server.start();

      console.log('');
      console.log(chalk.green('  wxa-runner 已启动'));
      console.log(`  地址      ${chalk.cyan(url)}`);
      console.log(`  项目      ${server.project.root}`);
      console.log(`  基础库    ${server.baseLib.version}`);
      console.log('');

      if (options.open) openBrowser(url);

      const shutdown = () => server.close().then(() => process.exit(0));
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      console.error(chalk.red('\n启动失败：'), error.message);
      process.exit(1);
    }
  });

const baselib = program.command('baselib').description('管理官方基础库');

baselib
  .command('list')
  .description('列出本机微信开发者工具已下载的基础库')
  .action(() => {
    const { listInstalledBaseLibs, MAX_COMPATIBLE_VERSION } = require('@open-wxa/wxa-runner-extractor');
    const libs = listInstalledBaseLibs();
    if (libs.length === 0) {
      console.log(chalk.yellow('没有找到基础库，请先安装并打开一次微信开发者工具'));
      return;
    }
    const defaultLib = libs.find(lib => lib.compatible);
    for (const lib of libs) {
      const mark = lib === defaultLib ? chalk.green(' (默认)') : lib.compatible ? '' : chalk.gray(` (> ${MAX_COMPATIBLE_VERSION}，暂不支持)`);
      console.log(`  ${lib.version}${mark}`);
    }
  });

baselib
  .command('extract [version]')
  .description('解包基础库到缓存目录（dev 命令会自动执行）')
  .action(version => {
    const { resolveBaseLib } = require('@open-wxa/wxa-runner-extractor');
    try {
      const lib = resolveBaseLib({ version });
      console.log(`${chalk.green('✓')} 基础库 ${lib.version} → ${lib.dir}`);
    } catch (error) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

program.parse();
