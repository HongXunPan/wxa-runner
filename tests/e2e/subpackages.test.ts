/**
 * 端到端：分包预下载和分包异步化，运行 examples/subpackages
 *
 * 基础库通过原生的 createLoadSubPackageTask、injectSubPackages 加载分包，调用方式因版本而异，
 * 本机有哪个已验证版本就测哪个。
 */

import path from 'path';
import { Frame } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../helpers';
import { e2eReady, expectText, installedBaseLibs, Runner, startRunner, VERIFIED_BASELIBS } from './runner';

describe.skipIf(!e2eReady)('分包预下载和分包异步化', () => {
  for (const version of VERIFIED_BASELIBS) {
    describe.skipIf(!installedBaseLibs.has(version))(`基础库 ${version}`, () => {
      let runner: Runner;
      const logs: string[] = [];

      const currentFrame = async (): Promise<Frame> => {
        const { frameName } = (await runner.page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
        return runner.page.frame({ name: frameName })!;
      };

      beforeAll(async () => {
        runner = await startRunner(path.join(EXAMPLES, 'subpackages'), { baseLibVersion: version });
        runner.page.on('console', message => logs.push(message.text()));
      });

      afterAll(async () => {
        await runner?.close();
      });

      it('打开首页后按 preloadRule 预下载分包', async () => {
        const preloaded = runner.page.waitForEvent('console', {
          predicate: message => message.text() === 'preloadSubpackages: success',
          timeout: 10000
        });
        await runner.open('/');
        await preloaded;
      });

      it('主包用 require.async 引用分包的 JS', async () => {
        const frame = await runner.open('/');
        await frame.click('#load-price');
        await expectText(frame, '#price', '¥19.99');
      });

      it('分包页面里另一个分包的组件替换掉占位组件，require 回调拿到另一个分包的 JS', async () => {
        logs.length = 0;
        await (await runner.open('/')).click('#to-list');
        await runner.page.evaluate(() => window.__wxa_test_api__.waitForPage('packageA/pages/list/list'));
        const frame = await currentFrame();

        await expectText(frame, '#card', '保温杯（packageB 的组件）');
        await expectText(frame, '#badge', '新品');
        await expectText(frame, '#price', '到手价 ¥59.00');
        expect(logs.filter(log => log.includes('尚未实现'))).toEqual([]);
        expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
      });
    });
  }
});
