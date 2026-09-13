<template>
  <view
    class="war-status"
    :class="{
      overdue: isOverdue,
      compact
    }"
    :aria-label="description"
  >
    <view
      v-if="statusNumber === 0 || statusNumber === 1"
      class="flag"
      :class="statusNumber === 1 ? 'flag-red' : 'flag-green'"
    >
      <view class="flag-pole"></view>
      <view class="flag-cloth"></view>
    </view>

    <view v-else class="leave-dot"></view>

    <text v-if="statusNumber === 1 && !iconOnly" class="status-text">
      {{
        days === null
          ? '红牌时间待补录'
          : `已挂红牌 ${days} 天`
      }}
    </text>

    <text v-else-if="!compact && !iconOnly" class="status-text">
      {{ statusNumber === 0 ? '参战绿牌' : '已离开' }}
    </text>

    <text v-if="isOverdue" class="overdue-tag">
      超过15天
    </text>
  </view>
</template>

<script>
export default {
  props: {
    status: {
      type: [Number, String],
      default: 0,
    },
    redDays: {
      type: [Number, String],
      default: null,
    },
    compact: {
      type: Boolean,
      default: false,
    },
    // 只显示旗帜/圆点, 不显示"已挂红牌 N 天"文案
    // (用于编辑页的状态选择按钮: 那是选择项, 不是成员真实状态)
    iconOnly: {
      type: Boolean,
      default: false,
    },
  },

  computed: {
    statusNumber() {
      return Number(this.status);
    },

    days() {
      if (
        this.redDays === null ||
        this.redDays === undefined ||
        this.redDays === ''
      ) {
        return null;
      }

      const value = Number(this.redDays);

      return Number.isInteger(value) && value >= 0
        ? value
        : null;
    },

    isOverdue() {
      return (
        this.statusNumber === 1 &&
        this.days !== null &&
        this.days > 15
      );
    },

    description() {
      if (this.statusNumber === 0) return '部落战绿牌';
      if (this.statusNumber === 2) return '已离开';

      return this.days === null
        ? '部落战红牌，开始时间待补录'
        : `部落战红牌，已挂红牌${this.days}天`;
    },
  },
};
</script>

<style scoped>
.war-status {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
  color: #728096;
}

.flag {
  position: relative;
  width: 30rpx;
  height: 32rpx;
  flex-shrink: 0;
}

.flag-pole {
  position: absolute;
  left: 3rpx;
  top: 1rpx;
  width: 4rpx;
  height: 30rpx;
  border-radius: 2rpx;
  background: currentColor;
}

.flag-cloth {
  position: absolute;
  left: 7rpx;
  top: 2rpx;
  width: 23rpx;
  height: 17rpx;
  border-radius: 2rpx 5rpx 5rpx 0;
  background: currentColor;
}

.flag-green {
  color: #24a878;
}

.flag-red {
  color: #e46671;
}

.leave-dot {
  width: 16rpx;
  height: 16rpx;
  margin: 0 7rpx;
  border-radius: 50%;
  background: #a5afbd;
}

.status-text {
  font-size: 23rpx;
  line-height: 1.5;
}

.overdue .status-text {
  color: #bd6c2e;
}

.overdue-tag {
  padding: 3rpx 9rpx;
  border-radius: 7rpx;
  color: #b76b2d;
  background: #fff1db;
  font-size: 20rpx;
}

.compact {
  gap: 7rpx;
}
</style>
