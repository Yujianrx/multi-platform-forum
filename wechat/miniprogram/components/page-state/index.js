Component({
  properties: { loading: Boolean, error: String, hasItems: Boolean, emptyText: String, skeleton: String },
  methods: { retry() { this.triggerEvent('retry'); } },
});
