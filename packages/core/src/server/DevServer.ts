/**
 * 开发服务器
 *
 *   /                          宿主页面
 *   /__wxa__/app-info.json     构建信息（__wxConfig、页面列表、设备参数、setup）
 *   /__wxa__/setup.js          编译后的 setup 文件
 *   /__wxa__/appservice.html   逻辑层
 *   /__wxa__/webview/<page>.html  渲染层（路径与页面一致，wxml 里的相对资源路径因此能正确解析）
 *   /__wxa__/module/<file>.js  单个业务 JS 模块
 *   /__baselib__/*             官方基础库
 *   /__wxa__/proxy?url=        网络代理
 *   /__wxa__/ws                文件变化通知
 *   其余路径                    小程序目录下的静态资源
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import express, { Express, NextFunction, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { resolveBaseLib, ResolvedBaseLib } from '@open-wxa/wxa-runner-extractor';
import { AppBuilder, BuildResult } from '../project/AppBuilder';
import { MiniProgram } from '../project/MiniProgram';
import type { AppInfo, DeviceProfile } from '../runtime/types';
import { appserviceHtml, hostHtml, webviewHtml } from './html';
import { handleProxy } from './proxy';
import { bundleSetup, collectSetupEnv, findSetupFile } from './setup';

export interface DevServerOptions {
  projectPath: string;
  /** 默认 3000，传 0 使用随机端口 */
  port?: number;
  host?: string;
  /** 指定基础库版本，默认使用本机已安装的最新兼容版本 */
  baseLibVersion?: string;
  baseLibCacheDir?: string;
  watch?: boolean;
  device?: Partial<DeviceProfile>;
  /**
   * 小程序启动前执行的 setup 文件；默认使用项目目录下的 wxa.setup.ts / .js / .mjs，传 false 不使用
   * 环境变量在构造时读取，只暴露 WXA_ 前缀的变量
   */
  setup?: string | false;
  /** 浏览器端运行时（host.js / frame.js）所在目录，默认取构建产物 */
  runtimeDir?: string;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export const DEFAULT_DEVICE: DeviceProfile = {
  model: 'iPhone X',
  screenWidth: 375,
  screenHeight: 812,
  pixelRatio: 3,
  statusBarHeight: 44,
  safeAreaBottom: 34,
  system: 'iOS 16.0',
  platform: 'devtools'
};

const WATCH_DEBOUNCE = 120;

export class DevServer {
  readonly project: MiniProgram;
  readonly builder: AppBuilder;
  readonly baseLib: ResolvedBaseLib;
  /** 生效的 setup 文件绝对路径，没有时为 null */
  readonly setupFile: string | null;
  private readonly setupEnv: Record<string, string>;
  private readonly device: DeviceProfile;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly app: Express;
  private server: http.Server | null = null;
  private sockets: WebSocketServer | null = null;
  private watcher: FSWatcher | null = null;
  private address = '';

  constructor(private readonly options: DevServerOptions) {
    this.logger = options.logger || console;
    this.project = new MiniProgram(path.resolve(options.projectPath));
    this.baseLib = resolveBaseLib({ version: options.baseLibVersion, cacheDir: options.baseLibCacheDir });
    if (!this.baseLib.compatible) {
      this.logger.warn(`[wxa-runner] 基础库 ${this.baseLib.version} 高于已验证的版本范围，可能无法正常运行`);
    }
    this.device = { ...DEFAULT_DEVICE, ...options.device };
    this.builder = new AppBuilder(this.project);
    this.setupFile = resolveSetupFile(options.setup, this.project.projectPath);
    this.setupEnv = collectSetupEnv(process.env);
    this.app = this.createApp();
  }

  get url(): string {
    return this.address;
  }

  async start(): Promise<string> {
    // 先构建一次：编译错误在终端里立即可见
    try {
      const build = await this.builder.build();
      this.logger.log(`[wxa-runner] 编译完成：${build.pages.length} 个页面，${build.components.length} 个组件，${build.durationMs}ms`);
    } catch (error) {
      this.logger.error(`[wxa-runner] 编译失败：\n${(error as Error).message}`);
    }

    const server = http.createServer(this.app);
    this.sockets = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (req.url?.startsWith('/__wxa__/ws')) {
        this.sockets!.handleUpgrade(req, socket, head, ws => this.sockets!.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    });

    const host = this.options.host || 'localhost';
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port ?? 3000, host, () => resolve());
    });
    this.server = server;

    const { port } = server.address() as { port: number };
    this.address = `http://${host}:${port}`;

    if (this.options.watch !== false) this.startWatching();
    return this.address;
  }

  async close() {
    await this.watcher?.close();
    this.sockets?.clients.forEach(client => client.terminate());
    this.sockets?.close();
    const server = this.server;
    this.server = null;
    if (server) {
      // 浏览器和 fetch 的 keep-alive 连接会让 close() 一直等到超时
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  private createApp(): Express {
    const app = express();
    const root = this.project.root;
    const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

    app.get('/', (_req, res) => {
      noStore(res);
      res.type('html').send(hostHtml());
    });

    app.get('/favicon.ico', (_req, res) => {
      res.status(204).end();
    });

    app.get('/__wxa__/app-info.json', async (_req, res) => {
      noStore(res);
      const base = { appid: this.project.appid, baseLibVersion: this.baseLib.version, device: this.device };
      try {
        const build = await this.builder.build();
        const info: AppInfo = { ...base, version: build.version, wxConfig: build.wxConfig, pages: build.pages };
        if (this.setupFile) info.setup = await this.setupInfo(this.setupFile);
        res.json(info);
      } catch (error) {
        res.json({ ...base, version: 0, wxConfig: {}, pages: [], buildError: (error as Error).message });
      }
    });

    app.get('/__wxa__/setup.js', async (_req, res) => {
      noStore(res);
      if (!this.setupFile) {
        res.status(404).type('text').send('没有 setup 文件');
        return;
      }
      try {
        res.type('js').send(await bundleSetup(this.setupFile));
      } catch (error) {
        res.status(500).type('text').send((error as Error).message);
      }
    });

    app.get('/__wxa__/appservice.html', this.withBuild((build, req, res) => {
      const launchPath = String(req.query.path || '').replace(/^\//, '');
      const launch = build.pages.includes(launchPath)
        ? { path: launchPath, query: Object.fromEntries(new URLSearchParams(String(req.query.query || ''))) }
        : { path: build.pages[0], query: {} };
      res.type('html').send(appserviceHtml(build, launch));
    }));

    app.get(/^\/__wxa__\/webview\/(.+)\.html$/, this.withBuild((build, req, res, next) => {
      const pagePath = decodeURIComponent(req.params[0]);
      if (!build.pages.includes(pagePath)) return next();
      res.type('html').send(webviewHtml(build, pagePath, Number(req.query.id)));
    }));

    app.get(/^\/__wxa__\/module\/(.+\.js)$/, this.withBuild((build, req, res) => {
      const id = decodeURIComponent(req.params[0]);
      if (!build.modules.includes(id)) {
        res.status(404).type('js').send(`console.error(${JSON.stringify(`[wxa-runner] 模块 ${id} 不存在`)})`);
        return;
      }
      res.type('js').send(this.builder.getModuleScript(id));
    }));

    app.get('/__wxa__/service-bootstrap.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.serviceBootstrap);
    }));

    app.get('/__wxa__/page-frame.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.pageFrame);
    }));

    app.use('/__wxa__/runtime', express.static(this.runtimeDir(), { cacheControl: false }));
    app.use('/__baselib__', express.static(this.baseLib.dir, { maxAge: '1d' }));
    app.all('/__wxa__/proxy', express.raw({ type: () => true, limit: '100mb' }), handleProxy);

    // 渲染层页面路径下的相对资源（如 ../../images/a.png）
    app.use('/__wxa__/webview', express.static(root));
    app.use(express.static(root));

    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      this.logger.error('[wxa-runner]', error);
      res.status(500).type('text').send(error.message);
    });

    return app;
  }

  /** 先编译一遍 setup：编译错误随 app-info 交给宿主显示，而不是让浏览器 import 失败 */
  private async setupInfo(file: string): Promise<NonNullable<AppInfo['setup']>> {
    try {
      await bundleSetup(file);
      return { env: this.setupEnv };
    } catch (error) {
      return { env: this.setupEnv, error: (error as Error).message };
    }
  }

  /** 需要构建结果的路由；构建失败时返回错误文本 */
  private withBuild(handler: (build: BuildResult, req: Request, res: Response, next: NextFunction) => void) {
    return async (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store');
      let build: BuildResult;
      try {
        build = await this.builder.build();
      } catch (error) {
        res.status(500).type('text').send((error as Error).message);
        return;
      }
      try {
        handler(build, req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  private runtimeDir(): string {
    const candidates = [
      this.options.runtimeDir,
      path.join(__dirname, 'runtime'),
      path.join(__dirname, '../runtime'),
      path.join(__dirname, '../../dist/runtime')
    ].filter((dir): dir is string => !!dir);
    const found = candidates.find(dir => fs.existsSync(path.join(dir, 'host.js')));
    if (!found) {
      throw new Error('找不到浏览器端运行时（host.js），请先执行 pnpm build');
    }
    return found;
  }

  private startWatching() {
    let changed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = async () => {
      const files = [...changed];
      changed = new Set();
      this.builder.invalidate(files);
      const label = files.length > 3 ? `${files.slice(0, 3).join(', ')} 等 ${files.length} 个文件` : files.join(', ');

      try {
        const build = await this.builder.build();
        this.logger.log(`[wxa-runner] ${label} 已更新，重新编译 ${build.durationMs}ms`);
        this.broadcast({ type: 'reload' });
      } catch (error) {
        const message = (error as Error).message;
        this.logger.error(`[wxa-runner] 编译失败：\n${message}`);
        this.broadcast({ type: 'error', message });
      }
    };

    // 项目目录下的 setup 文件不一定在小程序根目录（miniprogramRoot）里
    const watched = [this.project.root];
    if (this.setupFile && path.relative(this.project.root, this.setupFile).startsWith('..')) watched.push(this.setupFile);
    this.watcher = chokidar.watch(watched, {
      ignoreInitial: true,
      ignored: /(^|[/\\])(node_modules|\.git)([/\\]|$)/
    });
    this.watcher.on('all', (_event, file) => {
      changed.add(path.relative(this.project.root, file).split(path.sep).join('/'));
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WATCH_DEBOUNCE);
    });
  }

  private broadcast(message: Record<string, unknown>) {
    const data = JSON.stringify(message);
    this.sockets?.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

function resolveSetupFile(option: string | false | undefined, projectPath: string): string | null {
  if (option === false) return null;
  if (!option) return findSetupFile(projectPath);
  const file = path.resolve(option);
  if (!fs.existsSync(file)) throw new Error(`找不到 setup 文件：${file}`);
  return file;
}
