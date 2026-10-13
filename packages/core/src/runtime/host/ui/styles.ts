export const SHELL_CSS = `
html, body { margin: 0; height: 100%; background: #eef0f3; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif; }
.wxa-stage { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px 0; box-sizing: border-box; }
.wxa-device { position: relative; overflow: hidden; background: #fff; border-radius: 28px; box-shadow: 0 0 0 10px #1f1f1f, 0 18px 50px rgba(0,0,0,.25); display: flex; flex-direction: column; }
.wxa-statusbar { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; font-size: 12px; font-weight: 600; box-sizing: border-box; }
.wxa-navbar { flex: none; height: 44px; position: relative; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.wxa-navbar.is-hidden, .wxa-statusbar.is-hidden { display: none; }
.wxa-navbar-title { font-size: 17px; font-weight: 600; max-width: 60%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wxa-navbar-back { position: absolute; left: 4px; top: 0; height: 44px; width: 44px; border: 0; background: none; color: inherit; font-size: 28px; line-height: 40px; cursor: pointer; }
.wxa-navbar-loading { width: 14px; height: 14px; margin-right: 6px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: wxa-spin .8s linear infinite; display: none; }
.wxa-navbar.is-loading .wxa-navbar-loading { display: inline-block; }
.wxa-capsule { position: absolute; right: 7px; top: 6px; width: 87px; height: 32px; box-sizing: border-box; border-radius: 16px; border: 1px solid rgba(0,0,0,.12); background: rgba(255,255,255,.6); }
.wxa-pages { flex: 1; position: relative; overflow: hidden; }
.wxa-pages iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.wxa-tabbar { flex: none; height: 50px; display: flex; border-top: 1px solid rgba(0,0,0,.1); box-sizing: border-box; }
.wxa-tabbar.is-hidden { display: none; }
.wxa-tabbar-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 10px; cursor: pointer; user-select: none; gap: 2px; }
.wxa-tabbar-item img { width: 24px; height: 24px; }
.wxa-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.wxa-mask { position: absolute; inset: 0; pointer-events: auto; }
.wxa-mask.is-dim { background: rgba(0,0,0,.5); }
.wxa-toast { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); min-width: 120px; max-width: 70%; padding: 14px 16px; border-radius: 8px; background: rgba(17,17,17,.75); color: #fff; font-size: 14px; text-align: center; box-sizing: border-box; pointer-events: none; }
.wxa-toast.has-icon { width: 136px; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
.wxa-toast-icon { font-size: 36px; line-height: 1; }
.wxa-toast-spinner { width: 34px; height: 34px; border: 3px solid #fff; border-right-color: transparent; border-radius: 50%; animation: wxa-spin .8s linear infinite; }
.wxa-modal { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 80%; background: #fff; border-radius: 12px; overflow: hidden; pointer-events: auto; text-align: center; }
.wxa-modal-title { padding: 24px 20px 8px; font-size: 17px; font-weight: 600; }
.wxa-modal-content { padding: 8px 20px 24px; font-size: 15px; color: #666; white-space: pre-wrap; word-break: break-word; }
.wxa-modal-input { width: calc(100% - 40px); margin: 0 20px 20px; padding: 8px; font-size: 15px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; }
.wxa-modal-actions { display: flex; border-top: 1px solid rgba(0,0,0,.1); }
.wxa-modal-actions button { flex: 1; height: 50px; border: 0; background: none; font-size: 17px; font-weight: 600; cursor: pointer; }
.wxa-modal-actions button + button { border-left: 1px solid rgba(0,0,0,.1); }
.wxa-actionsheet { position: absolute; left: 0; right: 0; bottom: 0; background: #f7f7f7; border-radius: 12px 12px 0 0; overflow: hidden; pointer-events: auto; }
.wxa-actionsheet-alert { padding: 16px; font-size: 13px; color: #888; text-align: center; background: #fff; }
.wxa-actionsheet button { display: block; width: 100%; height: 56px; border: 0; border-top: 1px solid rgba(0,0,0,.06); background: #fff; font-size: 17px; cursor: pointer; }
.wxa-actionsheet .wxa-actionsheet-cancel { margin-top: 8px; border-top: 0; }
.wxa-error { position: absolute; inset: 0; z-index: 20; overflow: auto; padding: 20px; background: #fff5f5; color: #c00; font: 12px/1.6 Menlo, monospace; white-space: pre-wrap; }
.wxa-toolbar { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #666; }
.wxa-toolbar button { border: 1px solid #ccc; background: #fff; border-radius: 4px; padding: 2px 10px; cursor: pointer; }
.wxa-route { font-family: Menlo, monospace; }
@keyframes wxa-spin { to { transform: rotate(360deg); } }
`;
