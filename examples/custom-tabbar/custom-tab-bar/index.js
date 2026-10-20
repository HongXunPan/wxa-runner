Component({
  data: { selected: 0, taps: 0 },
  methods: {
    switch(e) {
      const { path, index } = e.currentTarget.dataset;
      // 离开前改变当前实例，返回时由页面 onShow 恢复，避免选中态断言始终为真。
      this.setData({ selected: Number(index), taps: this.data.taps + 1 });
      wx.switchTab({ url: path });
    }
  }
});
