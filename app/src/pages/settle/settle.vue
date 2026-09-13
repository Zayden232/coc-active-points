<template>
  <view class="page">
    <view v-if="!canWrite" class="visitor-tip">👁 访客模式 · 只读（可查看结算历史与红包发放状态）</view>
    <!-- 执行结算 -->
    <view class="card">
      <text class="card-title">执行结算</text>
      <view class="tabs">
        <view v-for="t in tabs" :key="t.v" class="tab" :class="{ on: type === t.v }" @click="switchType(t.v)">
          {{ t.label }}
        </view>
      </view>
      <scroll-view scroll-x class="cycles" :show-scrollbar="false">
        <view v-for="c in cycles" :key="c" class="cyc" :class="{ on: cycleStart === c }" @click="cycleStart = c; load()">
          {{ c }}
        </view>
      </scroll-view>

      <view class="preview">
        <view v-for="m in rows" :key="m.member_id" class="prow">
          <text class="prank" :class="{ champ: m.rank === 1 }">{{ m.rank === 1 ? '👑' : m.rank }}</text>
          <text class="pname">{{ m.nickname }}</text>
          <text class="pscore">{{ m.total }}</text>
        </view>
      </view>

      <button v-if="canWrite" class="btn-sm" :disabled="!cycleStart || settled" @click="doSettle">
        {{ settled ? '该周期已结算' : '结算并生成奖励' }}
      </button>
      <text v-if="settleResult" class="result">{{ settleResult }}</text>
    </view>

    <!-- 结算历史 -->
    <view class="card">
      <text class="card-title">结算历史</text>
      <view v-for="c in history" :key="c.cycle_type + c.cycle_start" class="hrow">
        <view class="hinfo">
          <text class="hname">{{ c.cycle_type === 'week' ? '周' : c.cycle_type === 'month' ? '月' : '赛季' }} · {{ c.cycle_start }}</text>
          <text class="hsub">{{ c.winner ? `冠军: ${c.winner.nickname} (${c.winner.total_score}分)` : '无冠军' }}</text>
        </view>
        <text v-if="canWrite" class="undo" @click="undo(c)">撤销</text>
      </view>
      <view v-if="!history.length" class="empty">暂无结算记录</view>
    </view>

    <!-- 红包记录 -->
    <view class="card">
      <text class="card-title">红包发放</text>
      <view v-for="r in rewards" :key="r.id" class="rrow">
        <view class="rinfo">
          <text class="rname">{{ r.nickname }} · {{ r.amount }}元</text>
          <text class="rsub">{{ r.cycle_type }} · {{ r.cycle_start }} · {{ r.note }}</text>
        </view>
        <view class="rpay" :class="{ paid: r.paid }" @click="togglePaid(r)">{{ r.paid ? '已发放' : '待发放' }}</view>
      </view>
      <view v-if="!rewards.length" class="empty">暂无红包记录</view>
    </view>
  </view>
</template>

<script>
import { get, post, del, put, canWrite as canWriteNow } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';

export default {
  data() {
    return {
      canWrite: true,
      tabs: [
        { v: 'week', label: '周结算' },
        { v: 'month', label: '月结算' },
        { v: 'season', label: '赛季结算' },
      ],
      type: 'week',
      cycleStart: '',
      cycles: [],
      rows: [],
      settled: false,
      settleResult: '',
      history: [],
      rewards: [],
    };
  },
  onLoad(opt) {
    if (opt && opt.type) this.type = opt.type;
  },
  onShow() {
    setBrowserTitle();
    this.canWrite = canWriteNow();
    this.loadCycles();
    this.loadHistory();
    this.loadRewards();
  },
  methods: {
    async loadCycles() {
      try {
        const res = await get('/ranking/cycles', { type: this.type, limit: 8 });
        this.cycles = res.cycles;
        if (!this.cycleStart || !this.cycles.includes(this.cycleStart)) this.cycleStart = this.cycles[0] || '';
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    },
    async load() {
      this.settled = false;
      if (!this.cycleStart) return;
      try {
        const res = await get('/ranking', { type: this.type, cycle_start: this.cycleStart });
        this.rows = res.rows;
        const list = await get('/settle/list', { type: this.type });
        this.settled = list.some((c) => c.cycle_start === this.cycleStart);
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    },
    async loadHistory() {
      try {
        this.history = await get('/settle/list', {});
      } catch (e) {
        /* ignore */
      }
    },
    async loadRewards() {
      try {
        this.rewards = await get('/settle/rewards', {});
      } catch (e) {
        /* ignore */
      }
    },
    switchType(t) {
      this.type = t;
      this.cycleStart = '';
      this.settleResult = '';
      this.loadCycles();
    },
    async doSettle() {
      if (!this.cycleStart || this.settled) return;
      uni.showModal({
        title: '确认结算',
        content: `结算 ${this.type} 周期 ${this.cycleStart}？`,
        success: async (r) => {
          if (!r.confirm) return;
          try {
            const res = await post('/settle', { type: this.type, cycle_start: this.cycleStart });
            if (res.already) {
              this.settleResult = '该周期已结算过';
            } else if (res.winner) {
              this.settleResult = `冠军: ${res.winner.nickname} · ${res.winner.total}分 · 奖励${res.winner.amount}元`;
            } else {
              this.settleResult = '已结算，本周无有效得分，未产生奖励';
            }
            this.settled = true;
            this.loadHistory();
            this.loadRewards();
          } catch (e) {
            uni.showToast({ title: e.message || '结算失败', icon: 'none' });
          }
        },
      });
    },
    undo(c) {
      uni.showModal({
        title: '撤销结算',
        content: `撤销 ${c.cycle_type} ${c.cycle_start} 的结算？`,
        success: async (r) => {
          if (!r.confirm) return;
          try {
            await del(`/settle/${c.cycle_type}/${c.cycle_start}`);
            uni.showToast({ title: '已撤销', icon: 'success' });
            this.loadHistory();
            this.loadRewards();
            this.load();
          } catch (e) {
            uni.showToast({ title: e.message || '撤销失败', icon: 'none' });
          }
        },
      });
    },
    async togglePaid(r) {
      if (!this.canWrite) return; // 访客只读
      try {
        await put('/settle/rewards/' + r.id, { paid: !r.paid });
        this.loadRewards();
      } catch (e) {
        uni.showToast({ title: e.message || '操作失败', icon: 'none' });
      }
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
.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.card-title {
  font-size: 30rpx;
  font-weight: 700;
  display: block;
  margin-bottom: 20rpx;
}
.tabs {
  display: flex;
  background: #e5e7eb;
  border-radius: 16rpx;
  padding: 6rpx;
  margin-bottom: 20rpx;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 14rpx 0;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #4b5563;
}
.tab.on {
  background: #fff;
  color: #4361ee;
  font-weight: 600;
}
.cycles {
  white-space: nowrap;
}
.cyc {
  display: inline-block;
  padding: 10rpx 20rpx;
  background: #f3f4f6;
  border-radius: 10rpx;
  margin-right: 12rpx;
  font-size: 22rpx;
  color: #6b7280;
  border: 2rpx solid transparent;
}
.cyc.on {
  border-color: #4361ee;
  color: #4361ee;
  font-weight: 600;
}
.preview {
  margin-top: 20rpx;
  max-height: 480rpx;
  overflow-y: auto;
}
.prow {
  display: flex;
  align-items: center;
  padding: 12rpx 0;
  border-bottom: 2rpx solid #f3f4f6;
}
.prank {
  width: 60rpx;
  font-weight: 700;
  color: #6b7280;
}
.prank.champ {
  font-size: 34rpx;
}
.pname {
  flex: 1;
  font-size: 28rpx;
}
.pscore {
  font-size: 28rpx;
  font-weight: 700;
  color: #4361ee;
}
.btn-sm {
  margin-top: 24rpx;
  height: 84rpx;
  line-height: 84rpx;
  background: #4361ee;
  color: #fff;
  border-radius: 12rpx;
  font-size: 28rpx;
}
.btn-sm[disabled] {
  opacity: 0.5;
}
.result {
  display: block;
  margin-top: 16rpx;
  color: #10b981;
  font-size: 26rpx;
}
.hrow,
.rrow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 2rpx solid #f3f4f6;
}
.hrow:last-child,
.rrow:last-child {
  border-bottom: none;
}
.hinfo,
.rinfo {
  display: flex;
  flex-direction: column;
}
.hname,
.rname {
  font-size: 28rpx;
  font-weight: 600;
}
.hsub,
.rsub {
  font-size: 22rpx;
  color: #9ca3af;
}
.undo {
  color: #ef4444;
  font-size: 26rpx;
}
.rpay {
  padding: 8rpx 24rpx;
  border-radius: 20rpx;
  background: #fff7e6;
  color: #b45309;
  font-size: 24rpx;
}
.rpay.paid {
  background: #ecfdf5;
  color: #10b981;
}
.empty {
  color: #9ca3af;
  text-align: center;
  padding: 30rpx 0;
  font-size: 24rpx;
}
</style>
