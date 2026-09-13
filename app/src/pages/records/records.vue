<template>
  <view class="page">
    <view v-if="!canWrite" class="visitor-tip">👁 访客模式 · 只读（不能修改或删除流水）</view>
    <view class="filter-bar">
      <text class="f-title">{{ filterText }}</text>
      <text class="f-count">共 {{ total }} 条</text>
    </view>

    <view class="list">
      <view v-for="r in rows" :key="r.id" class="row">
        <view class="info">
          <text class="line1">{{ r.nickname }} · {{ r.rule_name }}</text>
          <text class="line2">{{ r.week_start }} · {{ r.note || '无备注' }} · {{ r.created_at }}</text>
        </view>
        <text class="score">+{{ r.score }}</text>
        <text v-if="canWrite" class="op" @click="edit(r)">改</text>
        <text v-if="canWrite" class="op del" @click="remove(r)">删</text>
      </view>
      <view v-if="!rows.length" class="empty">暂无记录</view>
    </view>

    <!-- 编辑弹层 -->
    <view v-if="editing" class="mask" @click="editing = null">
      <view class="modal" @click.stop>
        <text class="m-title">修改记录</text>
        <text class="m-sub">{{ editing.nickname }} · {{ editing.rule_name }}</text>
        <input class="m-input" type="digit" v-model="editQty" placeholder="数量" />
        <input class="m-input" v-model="editNote" placeholder="备注(可选)" />
        <view class="m-btns">
          <button class="m-btn gray" @click="editing = null">取消</button>
          <button class="m-btn" @click="saveEdit">保存</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { get, put, del, canWrite as canWriteNow } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';

export default {
  data() {
    return {
      canWrite: true,
      member_id: null,
      type: '',
      cycle_start: '',
      client_token: '',
      rows: [],
      total: 0,
      editing: null,
      editQty: '',
      editNote: '',
    };
  },
  computed: {
    filterText() {
      const parts = [];
      if (this.client_token) parts.push('本批录入');
      if (this.member_id) parts.push('按成员');
      if (this.type) parts.push(this.type);
      if (this.cycle_start) parts.push(this.cycle_start);
      return parts.join(' · ') || '全部记录';
    },
  },
  onLoad(opt) {
    if (opt.member_id) this.member_id = Number(opt.member_id);
    if (opt.type) this.type = opt.type;
    if (opt.cycle_start) this.cycle_start = opt.cycle_start;
    if (opt.client_token) this.client_token = opt.client_token;
    this.load();
  },
  onShow() {
    setBrowserTitle();
    this.canWrite = canWriteNow();
  },
  methods: {
    async load() {
      try {
        const q = { limit: 200 };
        if (this.member_id) q.member_id = this.member_id;
        if (this.client_token) q.client_token = this.client_token;
        if (this.type && this.cycle_start) {
          q.type = this.type;
          q.cycle_start = this.cycle_start;
        }
        const res = await get('/records', q);
        this.rows = res.rows;
        this.total = res.total;
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    },
    edit(r) {
      this.editing = r;
      this.editQty = String(r.quantity);
      this.editNote = r.note;
    },
    async saveEdit() {
      try {
        await put('/records/' + this.editing.id, { quantity: Number(this.editQty), note: this.editNote });
        this.editing = null;
        uni.showToast({ title: '已保存', icon: 'success' });
        this.load();
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none' });
      }
    },
    remove(r) {
      uni.showModal({
        title: '删除记录',
        content: `删除「${r.nickname}」的 ${r.rule_name} +${r.score} 分？`,
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await del('/records/' + r.id);
            this.load();
          } catch (e) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' });
          }
        },
      });
    },
  },
};
</script>

<style scoped>
.page {
  padding: 24rpx;
}
.visitor-tip {
  background: #fff7e6;
  color: #b45309;
  border: 2rpx solid #fde68a;
  border-radius: 16rpx;
  padding: 18rpx 24rpx;
  font-size: 26rpx;
  margin-bottom: 20rpx;
}
.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}
.f-title {
  font-size: 26rpx;
  color: #6b7280;
}
.f-count {
  font-size: 24rpx;
  color: #9ca3af;
}
.list {
  background: #fff;
  border-radius: 20rpx;
  padding: 8rpx 28rpx;
}
.row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f3f4f6;
}
.row:last-child {
  border-bottom: none;
}
.info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.line1 {
  font-size: 28rpx;
  font-weight: 600;
}
.line2 {
  font-size: 22rpx;
  color: #9ca3af;
  margin-top: 4rpx;
}
.score {
  font-size: 30rpx;
  font-weight: 700;
  color: #10b981;
  margin: 0 20rpx;
}
.op {
  font-size: 26rpx;
  color: #4361ee;
  margin-left: 20rpx;
}
.op.del {
  color: #ef4444;
}
.empty {
  color: #9ca3af;
  text-align: center;
  padding: 60rpx 0;
  font-size: 26rpx;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.modal {
  width: 640rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx;
  display: flex;
  flex-direction: column;
}
.m-title {
  font-size: 32rpx;
  font-weight: 700;
}
.m-sub {
  font-size: 24rpx;
  color: #9ca3af;
  margin: 8rpx 0 24rpx;
}
.m-input {
  height: 88rpx;
  background: #f9fafb;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  border: 2rpx solid #e5e7eb;
  margin-bottom: 20rpx;
  box-sizing: border-box;
}
.m-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 8rpx;
}
.m-btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  background: #4361ee;
  color: #fff;
  border-radius: 12rpx;
  font-size: 28rpx;
}
.m-btn.gray {
  background: #f3f4f6;
  color: #374151;
}
</style>
