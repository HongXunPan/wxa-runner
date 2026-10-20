/** 上游同步的纯校验规则；不执行 Git、网络请求或候选代码。 */
export const REPOSITORY = 'HongXunPan/wxa-runner';
export const UPSTREAM = 'open-wxa/wxa-runner';
export const STATUS_CONTEXT = 'upstream-sync-ci';

const CONTROL_FILES = new Set([
  'commitlint.config.mjs',
  'scripts/check-branch-name.mjs',
  'scripts/release.mjs',
  'release-please-config.json',
  '.release-please-manifest.json'
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSha(value) {
  requireCondition(typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value), '提交 SHA 无效');
}

/** 只有个人 fork 的 main 定时或手动任务可使用写权限控制链路。 */
export function assertTrustedRun(env) {
  requireCondition(env.GITHUB_REPOSITORY === REPOSITORY, '不允许在其他仓库运行同步控制任务');
  requireCondition(env.GITHUB_REF === 'refs/heads/main', '同步控制任务只能从 main 运行');
  requireCondition(['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), '不允许此事件运行同步控制任务');
  requireSha(env.GITHUB_SHA);
  requireCondition(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? ''), '运行编号无效');
}

/** 将跨 job 输入收口为不可变候选，禁止分支名或 SHA 被当作命令参数注入。 */
export function readCandidate(env) {
  const candidate = {
    baseSha: env.BASE_SHA,
    headSha: env.CANDIDATE_SHA,
    upstreamSha: env.UPSTREAM_SHA,
    branch: env.SYNC_BRANCH,
    number: Number(env.PR_NUMBER)
  };
  [candidate.baseSha, candidate.headSha, candidate.upstreamSha].forEach(requireSha);
  requireCondition(candidate.baseSha === env.GITHUB_SHA, '候选基线与可信工作流版本不一致');
  requireCondition(candidate.headSha !== candidate.baseSha, '候选提交不能等于基线');
  requireCondition(candidate.branch === `ci/upstream-${candidate.upstreamSha.slice(0, 12)}`, '候选分支名不匹配');
  requireCondition(/^[1-9]\d*$/.test(env.PR_NUMBER ?? '') && Number.isSafeInteger(candidate.number), 'PR 编号无效');
  return Object.freeze(candidate);
}

/** 自动化自身、权限与发布配置的变化必须转人工；重命名时旧路径和新路径都要传入。 */
export function sensitiveFiles(files) {
  requireCondition(Array.isArray(files) && files.every((file) => typeof file === 'string'), '变更文件列表无效');
  return files.filter(
    (file) =>
      file.startsWith('.github/') ||
      file.startsWith('.husky/') ||
      file.startsWith('.codex/') ||
      file.startsWith('scripts/upstream-sync') ||
      CONTROL_FILES.has(file)
  );
}

/** 不仅检查分支前缀，还校验作者、仓库、PR 状态和两端提交。 */
export function assertSyncPullRequest(pr, candidate) {
  requireCondition(
    pr.number === candidate.number && pr.state === 'open' && pr.draft === false,
    '同步 PR 已关闭、是草稿或编号不匹配'
  );
  requireCondition(pr.user?.login === 'github-actions[bot]' && pr.user?.type === 'Bot', 'PR 不是同步机器人创建的');
  requireCondition(
    pr.base?.repo?.full_name === REPOSITORY && pr.head?.repo?.full_name === REPOSITORY,
    'PR 不属于本 fork'
  );
  requireCondition(pr.base.ref === 'main' && pr.head.ref === candidate.branch, 'PR 分支不匹配');
  requireCondition(pr.base.sha === candidate.baseSha && pr.head.sha === candidate.headSha, 'PR 基线或候选提交已变化');
}

/** 最终写 main 前重新验证全部条件；不依赖可伪造的标签、标题或其他提交的绿勾。 */
export function assertMergeAllowed({ candidate, pr, main, ciResult, workflows, files, parents }) {
  assertSyncPullRequest(pr, candidate);
  requireCondition(ciResult === 'success', '完整 CI 未通过，不允许合入');
  requireCondition(pr.mergeable === true, 'PR 存在冲突或尚未确认可合并');
  requireCondition(main.commit?.sha === candidate.baseSha, 'main 已推进，停止合入旧基线候选');
  requireCondition(main.protected === false, 'main 存在保护规则，转人工处理，不绕过门禁');
  requireCondition(
    parents.length === 2 && parents[0] === candidate.baseSha && parents[1] === candidate.upstreamSha,
    '候选不是本次基线与上游的普通合并提交'
  );
  requireCondition(sensitiveFiles(files).length === 0, '候选包含自动化、权限或发布配置变更，必须人工处理');
  for (const path of ['.github/workflows/release.yml', '.github/workflows/docs.yml']) {
    requireCondition(
      workflows.some((workflow) => workflow.path === path && workflow.state === 'disabled_manually'),
      'Release/Docs 暂停状态已变化，停止自动合入'
    );
  }
}
