// 提交信息按 Conventional Commits 写：release-please 靠类型决定发不发版、升哪一位、写进 CHANGELOG 的哪一节
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 这条规则是给英文描述定的；中文描述常以 README、Playwright 等英文专有名词开头，会被误判为首字母大写
    'subject-case': [0]
  }
};
