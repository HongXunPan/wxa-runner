// 部分用例用 wxaServerOptions.setup 指定：验证撤销 setup 的声明后再次打开页面不会恢复
export default {
  mock: { login: { code: 'from-setup' } },
  network: { routes: { 'POST **/api/feedback': { body: { ok: 'from-setup' } } } }
};
