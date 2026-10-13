const KEY = 'showcase:visits'

function recordVisit() {
  const visits = (wx.getStorageSync(KEY) || 0) + 1
  wx.setStorageSync(KEY, visits)
  return visits
}

module.exports = { recordVisit }
