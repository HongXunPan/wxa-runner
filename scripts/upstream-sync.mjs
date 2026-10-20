/** 上游同步的 Git/GitHub 操作；候选代码只交给独立的只读 CI 执行。 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  assertMergeAllowed,
  assertSyncPullRequest,
  assertTrustedRun,
  readCandidate,
  REPOSITORY,
  sensitiveFiles,
  STATUS_CONTEXT,
  UPSTREAM
} from './upstream-sync-policy.mjs';

const repositoryPath = `repos/${REPOSITORY}`;

/** 沿用仓内 Node 命令脚本模式；所有外部调用非交互、有超时、不自动重试。 */
function systemIO() {
  const run = (command, args, input) =>
    execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'inherit'],
      input,
      env: {
        ...process.env,
        GH_HOST: 'github.com',
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_HTTP_LOW_SPEED_LIMIT: '1',
        GIT_HTTP_LOW_SPEED_TIME: '30'
      }
    }).trim();
  return {
    git: (args) => run('git', args),
    api(method, path, body, paginate = false) {
      const args = ['api', '--method', method, path];
      if (body) args.push('--input', '-');
      if (paginate) args.push('--paginate', '--slurp');
      const result = JSON.parse(run('gh', args, body ? JSON.stringify(body) : undefined));
      return paginate ? result.flat() : result;
    },
    output(values) {
      if (!process.env.GITHUB_OUTPUT) throw new Error('缺少 GitHub job 输出文件');
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}\n`)
          .join('')
      );
    },
    log: (message) => console.log(message)
  };
}

function pullRequests(io, query) {
  const params = new URLSearchParams({ base: 'main', per_page: '100', ...query });
  return io.api('GET', `${repositoryPath}/pulls?${params}`, undefined, true);
}

function changedFiles(io, candidate) {
  // 禁用重命名识别，使移出控制目录的旧路径也进入人工检查。
  return io
    .git(['diff', '--name-only', '--no-renames', '-z', candidate.baseSha, candidate.headSha])
    .split('\0')
    .filter(Boolean);
}

function writeStatus(io, env, candidate, state, description) {
  io.api('POST', `${repositoryPath}/statuses/${candidate.headSha}`, {
    state,
    description,
    context: STATUS_CONTEXT,
    target_url: `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
  });
}

function candidateEnvironment(env, baseSha, headSha, upstreamSha, branch, number) {
  return {
    ...env,
    BASE_SHA: baseSha,
    CANDIDATE_SHA: headSha,
    UPSTREAM_SHA: upstreamSha,
    SYNC_BRANCH: branch,
    PR_NUMBER: String(number)
  };
}

/** 不覆盖已有候选或处理过的版本；发现控制面变更仍创建 PR，但不进入自动验证/合入。 */
export function prepare(env = process.env, io = systemIO()) {
  assertTrustedRun(env);
  io.output({ eligible: 'false' });
  const pending = pullRequests(io, { state: 'open' }).filter(
    (pr) => pr.head?.repo?.full_name === REPOSITORY && /^ci\/upstream-[0-9a-f]{12}$/.test(pr.head.ref)
  );
  if (pending.length) {
    io.log(`已有待处理同步 PR，不覆盖、不重试：${pending.map((pr) => pr.html_url).join('、')}`);
    return;
  }
  const baseSha = env.GITHUB_SHA;
  const main = io.api('GET', `${repositoryPath}/git/ref/heads/main`);
  if (main.object.sha !== baseSha || io.git(['rev-parse', 'HEAD']) !== baseSha)
    throw new Error('main 已变化，停止旧版本同步任务');
  io.git(['fetch', '--no-tags', `https://github.com/${UPSTREAM}.git`, 'refs/heads/main:refs/remotes/upstream/main']);
  const upstreamSha = io.git(['rev-parse', 'refs/remotes/upstream/main']);
  let included = false;
  try {
    io.git(['merge-base', '--is-ancestor', upstreamSha, baseSha]);
    included = true;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (included) {
    io.log('main 已包含当前上游，无需创建同步 PR。');
    return;
  }
  return createCandidate(io, env, baseSha, upstreamSha);
}

function createCandidate(io, env, baseSha, upstreamSha) {
  if (!/^[0-9a-f]{40}$/.test(upstreamSha) || /^0+$/.test(upstreamSha)) throw new Error('上游 SHA 无效');
  const branch = `ci/upstream-${upstreamSha.slice(0, 12)}`;
  if (pullRequests(io, { state: 'all', head: `HongXunPan:${branch}` }).length) {
    io.log('此上游版本已有 PR 处理记录，请人工检查，不重复创建。');
    return;
  }
  const refs = io.api('GET', `${repositoryPath}/git/matching-refs/heads/${branch}`);
  if (refs.some((ref) => ref.ref === `refs/heads/${branch}`)) throw new Error('候选分支已存在但没有对应 PR，不覆盖');
  io.git(['config', 'user.name', 'github-actions[bot]']);
  io.git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  io.git(['switch', '--no-track', '-c', branch]);
  io.git(['merge', '--no-ff', upstreamSha, '-m', `chore: 合并上游 main（${upstreamSha.slice(0, 12)}）`]);
  const headSha = io.git(['rev-parse', 'HEAD']);
  const files = sensitiveFiles(changedFiles(io, { baseSha, headSha }));
  io.git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  const pr = io.api('POST', `${repositoryPath}/pulls`, {
    base: 'main',
    head: branch,
    title: `chore: 同步上游 main（${upstreamSha.slice(0, 12)}）`,
    body: `## 同步范围\n- 来源：${UPSTREAM}，提交：${upstreamSha}。\n- 基线：${baseSha}；候选：${headSha}。\n\n## 合入策略\n- 普通更新由可信 main 工作流执行完整只读 CI，通过后仅非强制快进合入已验证提交。\n- 冲突、校验失败、基线变化或控制面变更时停止，不强推、不自动重试。\n- 原生 PR CI 可能等待批准，以 upstream-sync-ci 对应的候选提交结果为准。\n- 不发布 npm 包或部署文档。\n${files.length ? `\n## 需人工审查的控制面变更\n${files.map((file) => `- ${JSON.stringify(file)}`).join('\n')}\n` : ''}`
  });
  const candidate = readCandidate(candidateEnvironment(env, baseSha, headSha, upstreamSha, branch, pr.number));
  assertSyncPullRequest(pr, candidate);
  io.output({
    eligible: String(files.length === 0),
    base_sha: baseSha,
    candidate_sha: headSha,
    upstream_sha: upstreamSha,
    branch,
    pr_number: String(candidate.number)
  });
  io.log(`${pr.html_url}：${files.length ? '控制面变更，转人工审查。' : '等待隔离的只读 CI。'}`);
  return candidate;
}

/** 独立 job 仅回写待运行状态，不执行候选代码。 */
export function pending(env = process.env, io = systemIO()) {
  assertTrustedRun(env);
  const candidate = readCandidate(env);
  assertSyncPullRequest(io.api('GET', `${repositoryPath}/pulls/${candidate.number}`), candidate);
  writeStatus(io, env, candidate, 'pending', '正在执行锁定候选提交的完整只读 CI');
}

function verifyForMerge(io, env, candidate) {
  const repository = io.api('GET', repositoryPath);
  if (repository.default_branch !== 'main') throw new Error('默认分支已变化，不自动合入');
  const pr = io.api('GET', `${repositoryPath}/pulls/${candidate.number}`);
  const main = io.api('GET', `${repositoryPath}/branches/main`);
  const workflows = io.api('GET', `${repositoryPath}/actions/workflows?per_page=100`).workflows;
  // 只取对象，不检出候选；运行的控制脚本始终来自工作流启动时的 main。
  io.git(['fetch', '--no-tags', 'origin', `refs/heads/${candidate.branch}`]);
  const parents = io.git(['show', '--no-patch', '--format=%P', candidate.headSha]).split(' ');
  assertMergeAllowed({
    candidate,
    pr,
    main,
    ciResult: env.CI_RESULT,
    workflows,
    parents,
    files: changedFiles(io, candidate)
  });
  const head = io.api('GET', `${repositoryPath}/git/ref/heads/${candidate.branch}`);
  if (head.object.sha !== candidate.headSha) throw new Error('候选分支已变化，停止合入');
}

/** 独立可信 job 复核后只快进已验证提交；权限、网络或并发变化均直接停止。 */
export function finish(env = process.env, io = systemIO()) {
  assertTrustedRun(env);
  const candidate = readCandidate(env);
  if (env.CI_RESULT !== 'success' || env.PENDING_RESULT !== 'success') {
    writeStatus(io, env, candidate, 'failure', '完整校验未成功，main 未修改，需人工处理');
    io.log('只读 CI 或状态初始化未成功，保留 PR，不合入 main。');
    return;
  }
  try {
    verifyForMerge(io, env, candidate);
  } catch (error) {
    writeStatus(io, env, candidate, 'error', '安全门禁未通过，main 未修改，需人工处理');
    throw error;
  }
  writeStatus(io, env, candidate, 'success', '完整 CI 与安全校验通过，候选提交已锁定');
  try {
    // 不用合并 API 重新生成未测试的合并树；并发分叉由服务器拒绝，绝不加 force。
    io.git(['push', 'origin', `${candidate.headSha}:refs/heads/main`]);
  } catch (error) {
    writeStatus(io, env, candidate, 'error', '非强制快进被拒绝或失败，请人工检查远端状态');
    throw error;
  }
  const main = io.api('GET', `${repositoryPath}/git/ref/heads/main`);
  if (main.object.sha !== candidate.headSha)
    throw new Error('快进后 main 状态与候选不一致，请人工检查；不回滚、不重试');
  io.log(`已将通过完整 CI 的 ${candidate.headSha} 非强制快进合入 main；GitHub 的 PR 间接合并状态可能稍后刷新。`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const commands = { prepare, pending, finish };
    if (!Object.hasOwn(commands, process.argv[2]))
      throw new Error('用法：node scripts/upstream-sync.mjs prepare|pending|finish');
    commands[process.argv[2]]();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
