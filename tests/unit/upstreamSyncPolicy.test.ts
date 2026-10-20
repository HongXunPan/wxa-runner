/** 上游同步的安全边界：只使用内存数据，不创建分支、临时项目或网络请求。 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { finish, pending, prepare } from '../../scripts/upstream-sync.mjs';
import {
  assertMergeAllowed,
  assertSyncPullRequest,
  assertTrustedRun,
  readCandidate,
  REPOSITORY,
  sensitiveFiles
} from '../../scripts/upstream-sync-policy.mjs';

const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const upstreamSha = 'c'.repeat(40);
const env = {
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_RUN_ID: '123',
  GITHUB_SHA: baseSha,
  BASE_SHA: baseSha,
  CANDIDATE_SHA: headSha,
  UPSTREAM_SHA: upstreamSha,
  SYNC_BRANCH: `ci/upstream-${upstreamSha.slice(0, 12)}`,
  PR_NUMBER: '3'
};

function allowed() {
  const candidate = readCandidate(env);
  return {
    candidate,
    pr: {
      number: 3,
      state: 'open',
      draft: false,
      mergeable: true,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      base: { ref: 'main', sha: baseSha, repo: { full_name: REPOSITORY } },
      head: { ref: env.SYNC_BRANCH, sha: headSha, repo: { full_name: REPOSITORY } }
    },
    main: { commit: { sha: baseSha }, protected: false },
    ciResult: 'success',
    workflows: ['release', 'docs'].map((name) => ({
      path: `.github/workflows/${name}.yml`,
      state: 'disabled_manually'
    })),
    files: ['packages/core/src/index.ts', 'tests/unit/example.test.ts'],
    parents: [baseSha, upstreamSha]
  };
}

/** 内存适配器仅记录调用，绝不会执行真实 Git 或 gh。 */
function scenario() {
  const ready = allowed();
  const state = {
    ...ready,
    included: false,
    existing: [] as unknown[],
    history: [] as unknown[],
    refs: [] as unknown[],
    checkoutSha: baseSha,
    remoteSha: baseSha,
    mergeFails: false,
    pushFails: false
  };
  const calls: { command: string; args: unknown[] }[] = [];
  const outputs: Record<string, string> = {};
  const statuses: Record<string, unknown>[] = [];
  const io = {
    git(args: string[]) {
      calls.push({ command: 'git', args });
      if (args[0] === 'rev-parse') return args[1] === 'HEAD' ? state.checkoutSha : upstreamSha;
      if (args[0] === 'merge-base' && !state.included) throw Object.assign(new Error('尚未包含'), { status: 1 });
      if (args[0] === 'merge') {
        if (state.mergeFails) throw new Error('合并冲突');
        state.checkoutSha = headSha;
      }
      if (args[0] === 'diff') return state.files.join('\0') + '\0';
      if (args[0] === 'show') return state.parents.join(' ');
      if (args[0] === 'push' && args[2].endsWith(':refs/heads/main')) {
        if (state.pushFails) throw new Error('非快进更新被拒绝');
        state.remoteSha = headSha;
      }
      return '';
    },
    api(method: string, route: string, body?: Record<string, unknown>) {
      calls.push({ command: 'gh', args: [method, route, body] });
      const url = new URL(route, 'https://api.github.com/');
      const endpoint = url.pathname;
      if (endpoint.endsWith('/pulls') && method === 'GET')
        return url.searchParams.get('state') === 'open' ? state.existing : state.history;
      if (endpoint.endsWith('/pulls') && method === 'POST')
        return { ...state.pr, html_url: 'https://github.com/example/pull/3' };
      if (endpoint.includes('/matching-refs/')) return state.refs;
      if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: state.remoteSha } };
      if (endpoint.includes('/git/ref/heads/')) return { object: { sha: state.pr.head.sha } };
      if (endpoint.endsWith('/pulls/3')) return state.pr;
      if (endpoint.endsWith('/branches/main')) return { ...state.main, commit: { sha: state.remoteSha } };
      if (endpoint.endsWith('/actions/workflows')) return { workflows: state.workflows };
      if (endpoint.includes('/statuses/')) {
        statuses.push(body!);
        return {};
      }
      if (endpoint.endsWith(`/repos/${REPOSITORY}`)) return { default_branch: 'main' };
      throw new Error(`未声明的 API 调用：${method} ${route}`);
    },
    output(values: Record<string, string>) {
      Object.assign(outputs, values);
    },
    log(_message: string) {}
  };
  return { state, calls, outputs, statuses, io };
}

function pushes(calls: ReturnType<typeof scenario>['calls']) {
  return calls.filter((call) => call.command === 'git' && call.args[0] === 'push');
}

describe('上游同步纯策略', () => {
  it('仅允许 main 上的定时或手动控制任务', () => {
    expect(() => assertTrustedRun(env)).not.toThrow();
    expect(() => assertTrustedRun({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' })).not.toThrow();
    for (const patch of [
      { GITHUB_REPOSITORY: 'other/repo' },
      { GITHUB_REF: 'refs/heads/ci/example' },
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_SHA: '--help' },
      { GITHUB_RUN_ID: '../123' }
    ])
      expect(() => assertTrustedRun({ ...env, ...patch })).toThrow();
  });

  it('锁定候选的基线、SHA、分支与 PR 编号', () => {
    expect(readCandidate(env)).toMatchObject({ baseSha, headSha, upstreamSha, number: 3 });
    expect(Object.isFrozen(readCandidate(env))).toBe(true);
    for (const patch of [
      { CANDIDATE_SHA: '--upload-pack=bad' },
      { BASE_SHA: headSha },
      { UPSTREAM_SHA: '0'.repeat(40) },
      { CANDIDATE_SHA: baseSha },
      { SYNC_BRANCH: 'ci/upstream-other' },
      { PR_NUMBER: '3\nother=value' },
      { PR_NUMBER: '9007199254740992' }
    ])
      expect(() => readCandidate({ ...env, ...patch })).toThrow();
  });

  it('普通源码、测试、版本和文档更新可以进入自动验证', () => {
    expect(sensitiveFiles(['packages/core/src/index.ts', 'package.json', 'pnpm-lock.yaml', 'README.md'])).toEqual([]);
    expect(() => assertMergeAllowed(allowed())).not.toThrow();
  });

  it.each([
    '.github/workflows/ci.yml',
    '.github/actions/run/action.yml',
    '.github/CODEOWNERS',
    '.husky/pre-push',
    '.codex/config.toml',
    'scripts/upstream-sync.mjs',
    'scripts/upstream-sync-policy.mjs',
    'scripts/check-branch-name.mjs',
    'commitlint.config.mjs',
    'scripts/release.mjs',
    'release-please-config.json',
    '.release-please-manifest.json'
  ])('控制面文件变化必须人工处理：%s', (file) => {
    expect(sensitiveFiles([file])).toEqual([file]);
    expect(() => assertMergeAllowed({ ...allowed(), files: [file] })).toThrow();
  });

  it.each(['failure', 'cancelled', 'skipped', ''])('CI 未完整成功时拒绝合入：%s', (ciResult) => {
    expect(() => assertMergeAllowed({ ...allowed(), ciResult })).toThrow();
  });

  it('不自动接管其他作者、其他仓库、关闭、草稿或被修改的 PR', () => {
    const ready = allowed();
    for (const patch of [
      { user: { login: 'someone', type: 'User' } },
      { state: 'closed' },
      { draft: true },
      { number: 4 },
      { head: { ...ready.pr.head, sha: 'd'.repeat(40) } },
      { head: { ...ready.pr.head, repo: { full_name: 'other/repo' } } },
      { head: { ...ready.pr.head, ref: 'ci/upstream-other' } },
      { base: { ...ready.pr.base, sha: 'd'.repeat(40) } }
    ])
      expect(() => assertSyncPullRequest({ ...ready.pr, ...patch }, ready.candidate)).toThrow();
  });

  it('main 推进、分支保护、冲突或合并状态未知时停止', () => {
    const ready = allowed();
    expect(() => assertMergeAllowed({ ...ready, main: { ...ready.main, commit: { sha: headSha } } })).toThrow();
    expect(() => assertMergeAllowed({ ...ready, main: { ...ready.main, protected: true } })).toThrow();
    for (const mergeable of [false, null]) {
      expect(() => assertMergeAllowed({ ...ready, pr: { ...ready.pr, mergeable } })).toThrow();
    }
  });

  it('拒绝错误父提交，保留真实的上游合并历史', () => {
    for (const parents of [[baseSha], [upstreamSha, baseSha], [baseSha, headSha], [baseSha, upstreamSha, headSha]]) {
      expect(() => assertMergeAllowed({ ...allowed(), parents })).toThrow();
    }
  });

  it('Release/Docs 任何一个不再手动暂停都拒绝自动合入', () => {
    for (const index of [0, 1]) {
      const ready = allowed();
      ready.workflows[index].state = 'active';
      expect(() => assertMergeAllowed(ready)).toThrow();
    }
    expect(() => assertMergeAllowed({ ...allowed(), workflows: [] })).toThrow();
  });
});

describe('上游同步操作边界', () => {
  it('CLI 拒绝继承属性伪装的子命令，写操作入口缺少可信运行环境时立即退出', () => {
    const script = path.resolve(__dirname, '../../scripts/upstream-sync.mjs');
    for (const command of ['constructor', 'toString', 'prepare', 'pending', 'finish']) {
      const result = spawnSync(process.execPath, [script, command], {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: process.env.PATH }
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
    }
  });

  it('无更新时不创建 PR、不推送分支', () => {
    const { state, io, calls, outputs } = scenario();
    state.included = true;
    expect(prepare(env, io)).toBeUndefined();
    expect(outputs.eligible).toBe('false');
    expect(pushes(calls)).toEqual([]);
    expect(calls.some((call) => call.command === 'gh' && call.args[0] === 'POST')).toBe(false);
  });

  it('存在待处理 PR、历史记录或孤立候选分支时不覆盖', () => {
    for (const mode of ['pending', 'history', 'branch']) {
      const { state, io, calls, outputs } = scenario();
      if (mode === 'pending') state.existing = [{ head: state.pr.head, html_url: '待处理 PR' }];
      if (mode === 'history') state.history = [{ number: 3 }];
      if (mode === 'branch') state.refs = [{ ref: `refs/heads/${env.SYNC_BRANCH}` }];
      if (mode === 'branch') expect(() => prepare(env, io)).toThrow();
      else expect(prepare(env, io)).toBeUndefined();
      expect(outputs.eligible).toBe('false');
      expect(pushes(calls)).toEqual([]);
    }
  });

  it('main 基线变化或合并冲突时，不创建 PR 或推送 main', () => {
    for (const mode of ['base', 'conflict']) {
      const { state, io, calls } = scenario();
      if (mode === 'base') state.remoteSha = upstreamSha;
      else state.mergeFails = true;
      expect(() => prepare(env, io)).toThrow();
      expect(pushes(calls)).toEqual([]);
    }
  });

  it.each([false, true])('创建候选但不直接写 main；敏感变化=%s', (sensitive) => {
    const { state, io, calls, outputs } = scenario();
    if (sensitive) state.files = ['.github/workflows/ci.yml'];
    expect(prepare(env, io)).toMatchObject({ headSha, baseSha, upstreamSha });
    expect(outputs.eligible).toBe(String(!sensitive));
    expect(outputs.candidate_sha).toBe(headSha);
    expect(pushes(calls).map((call) => call.args)).toEqual([['push', 'origin', `HEAD:refs/heads/${env.SYNC_BRANCH}`]]);
    expect(calls.some((call) => call.command === 'git' && call.args[0] === 'merge' && call.args[1] === '--no-ff')).toBe(
      true
    );
  });

  it('状态绑定候选 SHA，不绑定工作流启动时的 main SHA', () => {
    const { io, calls, statuses } = scenario();
    pending(env, io);
    expect(statuses[0]).toMatchObject({ state: 'pending', context: 'upstream-sync-ci' });
    expect(calls.some((call) => call.args[1] === `repos/${REPOSITORY}/statuses/${headSha}`)).toBe(true);
    expect(pushes(calls)).toEqual([]);
  });

  it.each(['failure', 'cancelled', 'skipped'])('CI 未成功只回写失败，不执行合入：%s', (ciResult) => {
    const { io, calls, statuses } = scenario();
    finish({ ...env, CI_RESULT: ciResult, PENDING_RESULT: 'success' }, io);
    expect(statuses[0].state).toBe('failure');
    expect(pushes(calls)).toEqual([]);
  });

  it('状态初始化失败也不合入', () => {
    const { io, calls } = scenario();
    finish({ ...env, CI_RESULT: 'success', PENDING_RESULT: 'failure' }, io);
    expect(pushes(calls)).toEqual([]);
  });

  it('合入前复查安全门禁，拒绝运行期间的控制面变化', () => {
    const { state, io, calls, statuses } = scenario();
    state.files = ['scripts/upstream-sync-policy.mjs'];
    expect(() => finish({ ...env, CI_RESULT: 'success', PENDING_RESULT: 'success' }, io)).toThrow();
    expect(statuses[0].state).toBe('error');
    expect(pushes(calls)).toEqual([]);
  });

  it('只快进通过完整 CI 的精确提交，不检出候选，不调用合并 API 或使用 force', () => {
    const { state, io, calls, statuses } = scenario();
    finish({ ...env, CI_RESULT: 'success', PENDING_RESULT: 'success' }, io);
    expect(pushes(calls).map((call) => call.args)).toEqual([['push', 'origin', `${headSha}:refs/heads/main`]]);
    expect(statuses[0].state).toBe('success');
    expect(state.remoteSha).toBe(headSha);
    expect(
      calls.some((call) => call.command === 'git' && ['checkout', 'switch', 'merge'].includes(String(call.args[0])))
    ).toBe(false);
    expect(calls.some((call) => String(call.args[1]).endsWith('/merge'))).toBe(false);
  });

  it('服务器拒绝快进时回写错误，但不重试或强推', () => {
    const { state, io, calls, statuses } = scenario();
    state.pushFails = true;
    expect(() => finish({ ...env, CI_RESULT: 'success', PENDING_RESULT: 'success' }, io)).toThrow();
    expect(pushes(calls)).toHaveLength(1);
    expect(statuses.map((status) => status.state)).toEqual(['success', 'error']);
    expect(state.remoteSha).toBe(baseSha);
  });
});

describe('上游同步工作流静态契约', () => {
  const root = path.resolve(__dirname, '../..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/sync-upstream-pr.yml'), 'utf8');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

  it('只读 CI 调用可信版本，不继承 secrets，并校验候选提交与分支规范', () => {
    const verify = workflow.split('\n  verify:\n')[1].split('\n  finish:\n')[0];
    expect(verify).toContain('contents: read');
    expect(verify).toContain('uses: ./.github/workflows/ci.yml');
    expect(verify).not.toContain(': write');
    expect(workflow).not.toContain('secrets: inherit');
    expect(ci.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(ci).toContain("github.event_name == 'pull_request' || inputs.candidate-sha != ''");
    expect(ci).toContain('pnpm exec commitlint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose');
    expect(ci).toContain('node scripts/check-branch-name.mjs "$BRANCH"');
  });

  it('CI 保留完整测试和只打包试跑，不调用发布或文档任务', () => {
    for (const command of ['pnpm build', 'pnpm test', 'pnpm test:playwright', 'node scripts/release.mjs --dry-run']) {
      expect(ci).toContain(`run: ${command}`);
    }
    expect(workflow).not.toContain('uses: ./.github/workflows/release.yml');
    expect(workflow).not.toContain('uses: ./.github/workflows/docs.yml');
  });

  it('整次运行被取消后不启动合入收尾 job', () => {
    const final = workflow.split('\n  finish:\n')[1];
    expect(final).toContain("if: always() && !cancelled() && needs.prepare.outputs.eligible == 'true'");
  });
});
