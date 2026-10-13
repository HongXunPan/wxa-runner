Component({
  properties: {
    label: { type: String, value: '计数' },
    value: { type: Number, value: 0 }
  },
  methods: {
    increase() {
      const value = this.data.value + 1
      this.setData({ value })
      this.triggerEvent('change', { value })
    }
  }
})
