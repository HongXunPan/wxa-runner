import { expect as baseExpect } from '@playwright/test';
import type { ExpectMatcherState, MatcherReturnType } from '@playwright/test';
import type { MiniProgram } from './miniProgram';

/** 反复读取直到满足断言或超时；读取出错（如还没打开小程序）也重试，错误写进失败信息 */
async function retry(
  state: ExpectMatcherState,
  name: string,
  expected: unknown,
  timeout: number | undefined,
  read: () => Promise<unknown>,
  assertion: 'toBe' | 'toMatchObject'
): Promise<MatcherReturnType> {
  let actual: unknown;
  let readError: unknown;
  let pass: boolean;
  try {
    const poll = baseExpect.poll(async () => {
      try {
        actual = await read();
        readError = undefined;
      } catch (error) {
        readError = error;
        throw error;
      }
      return actual;
    }, { timeout: timeout ?? state.timeout });
    await (state.isNot ? poll.not : poll)[assertion](expected as never);
    pass = true;
  } catch {
    pass = false;
  }
  if (state.isNot) pass = !pass;

  const message = () => [
    state.utils.matcherHint(name, undefined, undefined, { isNot: state.isNot }),
    '',
    `Expected: ${state.isNot ? 'not ' : ''}${state.utils.printExpected(expected)}`,
    readError ? `Error: ${readError instanceof Error ? readError.message : String(readError)}` : `Received: ${state.utils.printReceived(actual)}`
  ].join('\n');
  return { pass, message, name, expected, actual };
}

export const miniProgramMatchers = {
  /**
   * 当前页是指定页面，不是时反复检查直到超时：点击跳转后不用手动等待
   * @param path 页面路径，如 pages/detail/detail，开头的 / 可有可无
   * @param options.timeout 毫秒，默认同 expect 的超时
   */
  toHavePath(this: ExpectMatcherState, miniProgram: MiniProgram, path: string, options: { timeout?: number } = {}) {
    const expected = path.replace(/^\/+/, '');
    return retry(this, 'toHavePath', expected, options.timeout, async () => (await miniProgram.currentPage())?.path ?? null, 'toBe');
  },

  /**
   * 页面的 data 包含给定的字段和值（同 toMatchObject，未列出的字段不比较），不满足时反复检查直到超时
   * @param options.path 不传时检查当前页，传页面路径时检查页面栈里的这个页面
   * @param options.timeout 毫秒，默认同 expect 的超时
   */
  toHavePageData(
    this: ExpectMatcherState,
    miniProgram: MiniProgram,
    expected: Record<string, unknown>,
    options: { path?: string; timeout?: number } = {}
  ) {
    return retry(this, 'toHavePageData', expected, options.timeout, () => miniProgram.pageData(options.path), 'toMatchObject');
  }
};
