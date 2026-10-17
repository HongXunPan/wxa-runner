/**
 * 检查分支名：「类型/短横线描述」，如 fix/wcc-split。类型和提交信息的一样（feat、fix、docs……）
 *
 *   node scripts/check-branch-name.mjs <分支名>...   检查给定的分支名（CI 用）
 *   node scripts/check-branch-name.mjs               从标准输入读 git 推送的 ref，只检查推送到远程的分支（pre-push hook 用）
 */
import fs from 'node:fs';
import conventional from '@commitlint/config-conventional';

const TYPES = conventional.rules['type-enum'][2];
const PATTERN = new RegExp(`^(${TYPES.join('|')})/[a-z0-9][a-z0-9._-]*$`);
// main，以及 release-please 在 GitHub 上开的发布分支
const isExempt = name => name === 'main' || name.startsWith('release-please--');

const names = process.argv.length > 2 ? process.argv.slice(2) : pushedBranches(fs.readFileSync(0, 'utf8'));
const invalid = names.filter(name => !isExempt(name) && !PATTERN.test(name));
if (invalid.length) {
  console.error(`分支名不符合规范：${invalid.join('、')}
应为「类型/短横线描述」，如 fix/wcc-split、feat/media-choose，类型可选：${TYPES.join('、')}
改名：git branch -m <新分支名>`);
  process.exit(1);
}

/**
 * pre-push 的标准输入每行是「本地 ref 本地 sha 远程 ref 远程 sha」。
 * 删除远程分支时本地 sha 全是 0，推送 tag 时远程 ref 不在 refs/heads/ 下，这两种都不检查
 */
function pushedBranches(input) {
  return input
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(([, localSha, remoteRef]) => remoteRef?.startsWith('refs/heads/') && !/^0+$/.test(localSha))
    .map(([, , remoteRef]) => remoteRef.slice('refs/heads/'.length));
}
