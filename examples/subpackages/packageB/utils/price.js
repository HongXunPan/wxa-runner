/** 以分为单位的金额格式化为 ¥x.xx */
exports.format = cents => `¥${(cents / 100).toFixed(2)}`;
