<template>
  <view class="page">
    <view class="page-content">
      <!-- 品牌与日期 -->
      <view class="page-heading">
        <view class="heading-main">
          <text class="eyebrow">CLAN ACTIVITY POINTS</text>
          <text class="page-title">部落活跃中心</text>
          <text class="page-description">
            凝聚每一份力量，记录每一次成长
          </text>
        </view>

        <view class="brand-emblem">
          <text>🏰</text>
        </view>
      </view>

      <!-- 公开浏览入口 -->
      <view v-if="!canWrite" class="visitor-tip">
        <view class="visitor-copy">
          <view class="visitor-dot"></view>
          <text>当前为公开只读浏览</text>
        </view>

        <button class="visitor-login" @click="goLogin">
          管理员登录
          <text class="small-arrow">›</text>
        </button>
      </view>

      <!-- 本周概览 -->
      <view class="hero">
        <view class="hero-orbit orbit-one"></view>
        <view class="hero-orbit orbit-two"></view>

        <view class="hero-content">
          <view class="hero-heading">
            <view>
              <text class="hero-eyebrow">WEEKLY OVERVIEW</text>
              <text class="hero-title">本周活跃</text>
            </view>

            <view class="hero-status">
              <view class="status-dot"></view>
              <text>本周概览</text>
            </view>
          </view>

          <text class="hero-sub">
            {{
              now.week_start
                ? formatDate(now.week_start) + ' 起 · 当前统计周期'
                : '部落活跃数据概览'
            }}
          </text>

          <view class="hero-stats">
            <view class="stat">
              <text class="stat-num">
                {{ ready ? formatCount(week_entries) : '—' }}
              </text>
              <text class="stat-label">本周录入</text>
            </view>

            <view class="stat">
              <text class="stat-num">
                {{ ready ? formatCount(week_members) : '—' }}
              </text>
              <text class="stat-label">活跃成员</text>
            </view>

            <view class="stat">
              <text class="stat-num">
                {{ ready ? formatCount(member_count) : '—' }}
              </text>
              <text class="stat-label">部落成员</text>
            </view>
          </view>

          <view class="hero-bottom">
            <view class="today-info">
              <text class="today-dot">✦</text>
              <text>
                今日已录入
                <text class="today-number">
                  {{ ready ? formatCount(today_entries) : '—' }}
                </text>
                笔
              </text>
            </view>

            <button
              class="hero-refresh"
              :disabled="loading"
              @click="load"
            >
              {{ loading ? '更新中…' : '刷新数据 ↻' }}
            </button>
          </view>
        </view>
      </view>

      <!-- 请求状态 -->
      <view v-if="loadError" class="load-notice">
        <view class="notice-copy">
          <text class="notice-title">
            {{ ready ? '数据暂未更新' : '暂时无法获取首页数据' }}
          </text>
          <text class="notice-description">
            {{ loadError }}
            {{ ready ? '，当前显示上次成功读取的数据。' : '' }}
          </text>
        </view>

        <button
          class="notice-action"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? '重试中' : '重试' }}
        </button>
      </view>

      <!-- 结算提醒 -->
      <button
        v-if="ready && !prev_week_settled && canWrite"
        class="settle-notice"
        @click="goSettle('week')"
      >
        <view class="settle-icon">!</view>

        <view class="notice-copy">
          <text class="settle-title">上周尚未结算</text>
          <text class="settle-description">
            前往结算页核对积分与奖励
          </text>
        </view>

        <text class="settle-action">去处理 ›</text>
      </button>

      <!-- 常用功能 -->
      <view class="shortcut-card">
        <view class="section-head compact-head">
          <text class="section-title">常用功能</text>
          <text class="section-caption">
            {{ canWrite ? '高效管理部落日常' : '发现部落的每一份活跃' }}
          </text>
        </view>

        <view class="shortcut-grid">
          <button
            class="shortcut"
            @click="
              go(
                canWrite
                  ? '/pages/entry/entry'
                  : '/pages/records/records'
              )
            "
          >
            <view class="shortcut-icon icon-blue">
              <text>{{ canWrite ? '📝' : '📋' }}</text>
            </view>
            <text class="shortcut-title">
              {{ canWrite ? '录入积分' : '积分流水' }}
            </text>
          </button>

          <button
            class="shortcut"
            @click="go('/pages/ranking/ranking')"
          >
            <view class="shortcut-icon icon-gold">
              <text>🏆</text>
            </view>
            <text class="shortcut-title">排行榜</text>
          </button>

          <button
            class="shortcut"
            @click="go('/pages/members/members')"
          >
            <view class="shortcut-icon icon-green">
              <text>👥</text>
            </view>
            <text class="shortcut-title">
              {{ canWrite ? '成员管理' : '部落成员' }}
            </text>
          </button>

          <button class="shortcut" @click="goSettle('week')">
            <view class="shortcut-icon icon-purple">
              <text>🧧</text>
            </view>
            <text class="shortcut-title">
              {{ canWrite ? '周期结算' : '结算历史' }}
            </text>
          </button>
        </view>
      </view>

      <!-- 趣味功能 -->
      <view class="feature-grid">
        <button class="feature-card wheel-card" @click="goWheel">
          <view class="feature-top">
            <view class="feature-icon wheel-icon">🎡</view>
            <text class="feature-tag wheel-tag">部落趣味</text>
          </view>

          <text class="feature-title">部落转盘</text>
          <text class="feature-description">
            {{
              canWrite
                ? '每日惊喜，抽取专属幸运'
                : '随机抽人，快乐不设限'
            }}
          </text>

          <view class="feature-bottom">
            <text>去转一转</text>
            <text class="feature-arrow">→</text>
          </view>
        </button>

        <!-- 创作工坊现在两端都能用: H5 是 fetch/Blob/IndexedDB,
             App 走 uni.downloadFile / uni.saveFile(见 utils/workshop-api.js、
             utils/workshop-db.js), 所以不再用 #ifdef H5 藏入口。 -->
        <button
          class="feature-card workshop-card"
          @click="goWorkshop"
        >
          <view class="feature-top">
            <view class="feature-icon workshop-icon">🎨</view>
            <text class="feature-tag workshop-tag">灵感空间</text>
          </view>

          <text class="feature-title">部落创作工坊</text>
          <text class="feature-description">
            AI 头像 · 趣味配图 · 图库
          </text>

          <view class="feature-bottom">
            <text>开启创作</text>
            <text class="feature-arrow">→</text>
          </view>
        </button>
      </view>

      <!-- 本周前三 -->
      <view class="ranking-section">
        <view class="section-head">
          <view>
            <view class="section-title-row">
              <text class="section-title">本周荣誉榜</text>
              <text class="top-label">TOP 3</text>
            </view>
            <text class="section-subtitle">
              每一份贡献，都值得被看见
            </text>
          </view>

          <button
            class="more-button"
            @click="go('/pages/ranking/ranking')"
          >
            全部排行 <text>›</text>
          </button>
        </view>

        <!-- 首次加载 -->
        <view v-if="!ready && loading" class="skeleton-list">
          <view
            v-for="item in 3"
            :key="item"
            class="skeleton-row"
          >
            <view class="skeleton-avatar"></view>
            <view class="skeleton-copy">
              <view class="skeleton-line long-line"></view>
              <view class="skeleton-line short-line"></view>
            </view>
            <view class="skeleton-score"></view>
          </view>
        </view>

        <view v-else-if="ready && top3.length" class="ranking-list">
          <view
            v-for="(member, index) in top3"
            :key="member.member_id"
            class="ranking-item"
            :class="'rank-' + (index + 1)"
          >
            <text class="rank-number">
              {{ '0' + (index + 1) }}
            </text>

            <view class="avatar-wrap">
              <view class="avatar">
                <text class="avatar-text">
                  {{ firstChar(member.nickname) }}
                </text>
              </view>
              <text class="avatar-medal">
                {{ ['🥇', '🥈', '🥉'][index] }}
              </text>
            </view>

            <view class="member-info">
              <text class="member-name">
                {{ member.nickname || '未命名成员' }}
              </text>

              <view class="member-meta">
                <text class="honor-tag">
                  {{ overallTitle(index) }}
                </text>
                <text class="member-tag">
                  {{ memberMeta(member) }}
                </text>
              </view>
            </view>

            <view class="member-score">
              <text class="score-number">
                {{ formatScore(member.total) }}
              </text>
              <text class="score-unit">积分</text>
            </view>
          </view>
        </view>

        <view v-else class="empty-state">
          <view class="empty-icon">🏆</view>
          <text class="empty-title">
            {{ ready ? '本周荣誉席位，等你点亮' : '荣誉榜暂未加载' }}
          </text>
          <text class="empty-description">
            {{
              ready
                ? '有了积分记录，这里就会展示本周活跃成员'
                : '请检查网络后刷新重试'
            }}
          </text>

          <button
            v-if="ready && canWrite"
            class="empty-button"
            @click="go('/pages/entry/entry')"
          >
            录入第一笔积分 →
          </button>
        </view>

        <view v-if="ready && top3.length" class="ranking-footer">
          荣誉称号仅作展示，奖励以结算规则为准
        </view>
      </view>

      <view class="page-footer">
        <view class="footer-line"></view>
        <text>并肩同行，让部落更有力量</text>
        <view class="footer-line"></view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  get,
  canWrite as canWriteNow,
  goLogin,
} from '@/utils/api';
import { navTo } from '@/utils/navigation';
import { setBrowserTitle } from '@/utils/h5';

export default {
  data() {
    return {
      // 默认不展示管理操作，避免首次渲染闪现。
      canWrite: false,
      active: false,
      ready: false,
      loading: false,
      loadError: '',
      requestId: 0,

      now: {
        today: '',
        week_start: '',
        month_start: '',
        season_start: '',
      },

      today_entries: 0,
      week_entries: 0,
      week_members: 0,
      member_count: 0,
      prev_week_settled: true,
      top3: [],
    };
  },

  onShow() {
    this.active = true;
    setBrowserTitle();
    this.canWrite = canWriteNow();
    this.load();
  },

  onHide() {
    this.active = false;
    this.requestId += 1;
    this.loading = false;
  },

  onUnload() {
    this.active = false;
    this.requestId += 1;
  },

  methods: {
    /** 前三名次行资料: 「大本营 14 · 繁荣 63」(原来显示游戏标签) */
    memberMeta(member) {
      if (!member) return '—';
      const th =
        member.town_hall == null || member.town_hall === '' ? '' : `大本营 ${member.town_hall}`;
      const pr =
        member.prosperity == null || member.prosperity === '' ? '' : `繁荣 ${member.prosperity}`;
      if (th && pr) return `${th} · ${pr}`;
      return th || pr || '—';
    },

    goLogin() {
      goLogin('');
    },

    async load() {
      if (!this.active || this.loading) return;

      const requestId = ++this.requestId;

      this.loading = true;
      this.loadError = '';

      try {
        const data = await get('/dashboard');

        if (
          !this.active ||
          requestId !== this.requestId
        ) {
          return;
        }

        if (
          !data ||
          typeof data !== 'object' ||
          !data.now ||
          !Array.isArray(data.top3)
        ) {
          throw new Error('首页接口返回格式异常');
        }

        this.now = {
          today: '',
          week_start: '',
          month_start: '',
          season_start: '',
          ...data.now,
        };

        this.today_entries = data.today_entries;
        this.week_entries = data.week_entries;
        this.week_members = data.week_members;
        this.member_count = data.member_count;

        // 只有明确返回“未结算”时才显示提醒。
        this.prev_week_settled = !(
          data.prev_week_settled === false ||
          data.prev_week_settled === 0 ||
          data.prev_week_settled === '0'
        );

        // 保持后端排名顺序，不在前端重新排序。
        this.top3 = data.top3.slice(0, 3);
        this.ready = true;
        this.canWrite = canWriteNow();

        this.maybePromptWheel();
      } catch (error) {
        if (
          this.active &&
          requestId === this.requestId
        ) {
          // 刷新失败保留旧数据，同时显示错误提示。
          this.loadError =
            (error && error.message) || '加载失败，请稍后重试';
        }
      } finally {
        if (requestId === this.requestId) {
          this.loading = false;
        }
      }
    },

    formatDate(value) {
      // 不使用 new Date，避免日期字符串被时区转换。
      return String(value || '')
        .slice(0, 10)
        .replace(/-/g, '.');
    },

    formatCount(value) {
      if (
        value === null ||
        value === undefined ||
        value === ''
      ) {
        return '—';
      }

      const number = Number(value);

      if (!Number.isFinite(number)) return '—';

      return String(Math.trunc(number)).replace(
        /\B(?=(\d{3})+(?!\d))/g,
        ','
      );
    },

    formatScore(value) {
      if (
        value === null ||
        value === undefined ||
        value === ''
      ) {
        return '—';
      }

      const number = Number(value);
      return Number.isFinite(number) ? String(number) : '—';
    },

    go(url) {
      // 继续由 navTo 判断 tabBar 页面，避免 navigateTo 错误。
      navTo(url);
    },

    goSettle(type) {
      navTo(
        '/pages/settle/settle?type=' +
        encodeURIComponent(type)
      );
    },

    goWheel() {
      navTo('/pages/wheel/wheel');
    },

    goWorkshop() {
      navTo('/pages/workshop/workshop');
    },

    maybePromptWheel() {
      if (
        !this.active ||
        !this.canWrite ||
        !canWriteNow()
      ) {
        return;
      }

      const today = this.now.today || '';
      if (!today) return;

      // 延续现有规则：当前客户端每天提醒一次。
      const key = `coc_wheel_prompt_${today}`;

      let seen = '';

      try {
        seen = uni.getStorageSync(key);
      } catch (error) {
        seen = '';
      }

      if (seen) return;

      try {
        uni.setStorageSync(key, '1');
      } catch (error) {
        // 本地存储不可用时，不影响首页展示。
      }

      uni.showModal({
        title: '🎡 今天的转盘来了',
        content:
          '每位成员每天可抽一次，有机会获得限时头像框 / 彩色昵称 / 称号。要现在去抽吗？',
        confirmText: '去抽取',
        cancelText: '稍后',
        success: (result) => {
          if (
            result.confirm &&
            this.active &&
            canWriteNow()
          ) {
            this.goWheel();
          }
        },
      });
    },

    firstChar(name) {
      const value = String(name || '').trim();
      return value ? Array.from(value)[0] : '?';
    },

    overallTitle(index) {
      return ['部落之光', '荣耀先锋', '精锐战将'][index] || '';
    },
  },
};
</script>

<style scoped>
/* 页面 */
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 32rpx 28rpx;
  padding-bottom: calc(36rpx + env(safe-area-inset-bottom));
  background: linear-gradient(
    160deg,
    #edf3ff 0,
    #f5f7fc 460rpx,
    #f7f9fc 100%
  );
  color: #293852;
}

.page-content {
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
}

button {
  box-sizing: border-box;
}

button::after {
  border: none;
}

button[disabled] {
  opacity: 0.55;
}

.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12rpx 4rpx 30rpx;
}

.heading-main {
  flex: 1;
  min-width: 0;
}

.eyebrow {
  display: block;
  color: #8d9cba;
  font-size: 18rpx;
  font-weight: 600;
  letter-spacing: 3rpx;
}

.page-title {
  display: block;
  margin-top: 12rpx;
  color: #263754;
  font-size: 42rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}

.page-description {
  display: block;
  margin-top: 12rpx;
  color: #8996ab;
  font-size: 22rpx;
  line-height: 1.7;
}

.brand-emblem {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 92rpx;
  height: 92rpx;
  margin-left: 20rpx;
  border: 1px solid #fff;
  border-radius: 28rpx;
  background: linear-gradient(145deg, #fff, #e9eeff);
  box-shadow: 0 10rpx 26rpx rgba(79, 106, 176, 0.08);
  font-size: 54rpx;
}

/* 访客提示 */
.visitor-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6rpx 20rpx;
  margin-bottom: 22rpx;
  border: 1px solid #e3eaf8;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.8);
}

.visitor-copy {
  display: flex;
  align-items: center;
  color: #7e8ca6;
  font-size: 22rpx;
}

.visitor-dot {
  width: 10rpx;
  height: 10rpx;
  flex-shrink: 0;
  margin-right: 12rpx;
  border-radius: 50%;
  background: #80a2e9;
}

.visitor-login {
  display: flex;
  align-items: center;
  min-height: 40px;
  margin: 0 0 0 10rpx;
  padding: 0;
  background: transparent;
  color: #5d7ad6;
  font-size: 22rpx;
  line-height: 1.5;
}

.small-arrow {
  margin-left: 10rpx;
  font-size: 30rpx;
}

/* 概览卡 */
.hero {
  position: relative;
  overflow: hidden;
  padding: 32rpx;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 30rpx;
  background: linear-gradient(115deg, #4b72e6, #6868dc);
  box-shadow: 0 18rpx 40rpx rgba(71, 98, 203, 0.19);
  color: #fff;
}

.hero-content {
  position: relative;
  z-index: 1;
}

.hero-orbit {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 50%;
  pointer-events: none;
}

.orbit-one {
  width: 420rpx;
  height: 420rpx;
  top: -240rpx;
  right: -120rpx;
}

.orbit-two {
  width: 520rpx;
  height: 520rpx;
  top: -290rpx;
  right: -170rpx;
  background: rgba(255, 255, 255, 0.025);
}

.hero-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-eyebrow {
  display: block;
  color: rgba(255, 255, 255, 0.6);
  font-size: 17rpx;
  letter-spacing: 3rpx;
}

.hero-title {
  display: block;
  margin-top: 10rpx;
  font-size: 35rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
}

.hero-status {
  display: flex;
  align-items: center;
  padding: 10rpx 16rpx;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.9);
}

.status-dot {
  width: 9rpx;
  height: 9rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #c6e9ff;
}

.hero-sub {
  display: block;
  margin-top: 12rpx;
  color: rgba(255, 255, 255, 0.7);
  font-size: 22rpx;
}

.hero-stats {
  display: flex;
  margin: 36rpx 0 30rpx;
}

.stat {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.stat + .stat {
  border-left: 1px solid rgba(255, 255, 255, 0.15);
}

.stat-num {
  display: block;
  padding: 0 6rpx;
  font-size: 46rpx;
  font-weight: 800;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.stat-label {
  display: block;
  margin-top: 12rpx;
  color: rgba(255, 255, 255, 0.74);
  font-size: 22rpx;
}

.hero-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14rpx;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.today-info {
  display: flex;
  align-items: center;
  color: rgba(255, 255, 255, 0.82);
  font-size: 22rpx;
}

.today-dot {
  margin-right: 10rpx;
  color: #e0ddff;
  font-size: 24rpx;
}

.today-number {
  padding: 0 6rpx;
  color: #fff;
  font-weight: 700;
}

.hero-refresh {
  min-height: 40px;
  margin: 0;
  padding: 0 0 0 14rpx;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  font-size: 21rpx;
  line-height: 40px;
}

.hero-refresh[disabled] {
  background: transparent;
  color: #fff;
}

/* 提示条 */
.load-notice,
.settle-notice {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 20rpx;
  margin: 22rpx 0 0;
  border: 1px solid #f3e4c9;
  border-radius: 18rpx;
  background: #fff9ed;
  text-align: left;
  line-height: 1.6;
}

.notice-copy {
  flex: 1;
  min-width: 0;
}

.notice-title,
.settle-title {
  display: block;
  color: #a77a33;
  font-size: 25rpx;
  font-weight: 600;
}

.notice-description,
.settle-description {
  display: block;
  margin-top: 5rpx;
  color: #b09871;
  font-size: 21rpx;
  overflow-wrap: anywhere;
}

.notice-action {
  flex-shrink: 0;
  min-height: 40px;
  margin: 0 0 0 16rpx;
  padding: 0 12rpx;
  background: transparent;
  color: #9f7d40;
  font-size: 23rpx;
  line-height: 40px;
}

.settle-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 48rpx;
  height: 48rpx;
  margin-right: 16rpx;
  border-radius: 15rpx;
  background: #fff0cb;
  color: #bf9246;
  font-size: 30rpx;
  font-weight: 700;
}

.settle-action {
  flex-shrink: 0;
  margin-left: 12rpx;
  color: #ad863f;
  font-size: 22rpx;
}

/* 通用卡片 */
.shortcut-card,
.ranking-section {
  padding: 28rpx;
  margin-top: 26rpx;
  border: 1px solid #eaf0f7;
  border-radius: 26rpx;
  background: #fff;
  box-shadow: 0 8rpx 28rpx rgba(40, 65, 110, 0.035);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 26rpx;
}

.section-title {
  color: #30415e;
  font-size: 29rpx;
  font-weight: 700;
}

.section-caption {
  margin-left: 12rpx;
  color: #99a5b8;
  font-size: 20rpx;
  text-align: right;
}

.section-subtitle {
  display: block;
  margin-top: 10rpx;
  color: #98a4b8;
  font-size: 21rpx;
}

/* 四个快捷入口 */
.compact-head {
  margin-bottom: 22rpx;
}

.shortcut-grid {
  display: flex;
}

.shortcut {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8rpx 2rpx;
  background: transparent;
  line-height: 1.5;
}

.shortcut-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 86rpx;
  height: 86rpx;
  border-radius: 25rpx;
  font-size: 40rpx;
}

.icon-blue {
  background: linear-gradient(140deg, #edf3ff, #e8edff);
}

.icon-gold {
  background: linear-gradient(140deg, #fff8e8, #fff0cf);
}

.icon-green {
  background: linear-gradient(140deg, #edf9f5, #e2f3ee);
}

.icon-purple {
  background: linear-gradient(140deg, #f6f0ff, #eee7fb);
}

.shortcut-title {
  margin-top: 16rpx;
  color: #586782;
  font-size: 23rpx;
  font-weight: 500;
}

/* 转盘与创作工坊 */
.feature-grid {
  display: flex;
  gap: 20rpx;
  margin-top: 24rpx;
}

.feature-card {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 24rpx;
  border: 1px solid transparent;
  border-radius: 24rpx;
  text-align: left;
  line-height: 1.5;
}

.wheel-card {
  border-color: #f2e6d1;
  background: linear-gradient(135deg, #fff9ed, #fff2df);
}

.workshop-card {
  border-color: #e8e1f8;
  background: linear-gradient(135deg, #f7f3ff, #eeeafd);
}

.feature-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22rpx;
}

.feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 65rpx;
  height: 65rpx;
  border-radius: 20rpx;
  font-size: 38rpx;
}

.wheel-icon {
  background: rgba(255, 255, 255, 0.75);
}

.workshop-icon {
  background: rgba(255, 255, 255, 0.7);
}

.feature-tag {
  margin-left: 8rpx;
  font-size: 18rpx;
}

.wheel-tag {
  color: #bc9b68;
}

.workshop-tag {
  color: #9b88bc;
}

.feature-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #66533a;
}

.workshop-card .feature-title {
  color: #665383;
}

.feature-description {
  display: block;
  margin-top: 9rpx;
  color: #ad987b;
  font-size: 20rpx;
  line-height: 1.7;
}

.workshop-card .feature-description {
  color: #9a8aae;
}

.feature-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 26rpx;
  padding-top: 16rpx;
  border-top: 1px solid rgba(182, 145, 87, 0.14);
  color: #a98449;
  font-size: 22rpx;
  font-weight: 600;
}

.workshop-card .feature-bottom {
  border-color: rgba(138, 106, 178, 0.13);
  color: #8c72b6;
}

.feature-arrow {
  font-size: 28rpx;
  font-weight: 400;
}

/* 荣誉榜 */
.section-title-row {
  display: flex;
  align-items: center;
}

.top-label {
  margin-left: 12rpx;
  padding: 3rpx 9rpx;
  border-radius: 7rpx;
  background: #fff5dd;
  color: #bc9349;
  font-size: 17rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
}

.more-button {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 40px;
  margin: 0 0 0 12rpx;
  padding: 0;
  background: transparent;
  color: #7187bd;
  font-size: 22rpx;
  line-height: 1.5;
}

.more-button text {
  margin-left: 8rpx;
  font-size: 30rpx;
}

.ranking-item {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
}

.ranking-item + .ranking-item {
  border-top: 1px solid #f0f3f8;
}

.rank-number {
  flex-shrink: 0;
  width: 36rpx;
  margin-right: 12rpx;
  color: #adb7c8;
  font-size: 24rpx;
  font-weight: 700;
  font-style: italic;
}

.rank-1 .rank-number {
  color: #c69c46;
}

.avatar-wrap {
  position: relative;
  flex-shrink: 0;
  margin-right: 20rpx;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
  box-sizing: border-box;
  border: 3rpx solid #d9e0ec;
  border-radius: 24rpx;
  background: #f2f5fa;
}

.avatar-text {
  font-size: 30rpx;
  font-weight: 700;
}

.avatar-medal {
  position: absolute;
  right: -7rpx;
  bottom: -8rpx;
  font-size: 29rpx;
  line-height: 1.2;
}

.rank-1 .avatar {
  border-color: #ecd296;
  background: linear-gradient(135deg, #fff8df, #fae9bd);
  color: #ad8739;
}

.rank-2 .avatar {
  border-color: #d8e0eb;
  background: linear-gradient(135deg, #f5f8fc, #e5ebf3);
  color: #7c8da6;
}

.rank-3 .avatar {
  border-color: #e8cdb8;
  background: linear-gradient(135deg, #fff5ec, #f5e2d2);
  color: #b0825f;
}

.member-info {
  flex: 1;
  min-width: 0;
}

.member-name {
  display: block;
  overflow: hidden;
  color: #3d4e6a;
  font-size: 27rpx;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 10rpx;
}

.honor-tag {
  flex-shrink: 0;
  padding: 3rpx 9rpx;
  border-radius: 7rpx;
  background: #f1f4f8;
  color: #8a98af;
  font-size: 18rpx;
}

.rank-1 .honor-tag {
  background: #fff6de;
  color: #b08a3c;
}

.rank-3 .honor-tag {
  background: #fbefe5;
  color: #b08866;
}

.member-tag {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: #a2adbd;
  font-size: 19rpx;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-score {
  flex-shrink: 0;
  max-width: 34%;
  margin-left: 16rpx;
  text-align: right;
}

.score-number {
  display: block;
  color: #607bca;
  font-size: 32rpx;
  font-weight: 750;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.rank-1 .score-number {
  color: #bc9448;
}

.score-unit {
  display: block;
  margin-top: 6rpx;
  color: #a0abbd;
  font-size: 19rpx;
}

.ranking-footer {
  margin-top: 12rpx;
  padding-top: 20rpx;
  border-top: 1px solid #f0f3f8;
  color: #a5afbf;
  font-size: 19rpx;
  line-height: 1.7;
  text-align: center;
}

/* 首次加载占位 */
.skeleton-row {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
}

.skeleton-avatar {
  flex-shrink: 0;
  width: 76rpx;
  height: 76rpx;
  margin-right: 20rpx;
  border-radius: 24rpx;
  background: #f0f3f8;
}

.skeleton-copy {
  flex: 1;
}

.skeleton-line {
  height: 20rpx;
  border-radius: 8rpx;
  background: #f0f3f8;
}

.long-line {
  width: 58%;
}

.short-line {
  width: 38%;
  height: 15rpx;
  margin-top: 16rpx;
}

.skeleton-score {
  width: 66rpx;
  height: 30rpx;
  margin-left: 20rpx;
  border-radius: 8rpx;
  background: #f0f3f8;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 36rpx 10rpx;
  text-align: center;
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 110rpx;
  height: 110rpx;
  border-radius: 34rpx;
  background: #fff8e9;
  font-size: 58rpx;
}

.empty-title {
  margin-top: 24rpx;
  color: #6d7d97;
  font-size: 27rpx;
  font-weight: 600;
}

.empty-description {
  margin-top: 12rpx;
  color: #a0abbd;
  font-size: 22rpx;
  line-height: 1.8;
}

.empty-button {
  min-height: 42px;
  margin: 26rpx 0 0;
  padding: 0 24rpx;
  border-radius: 14rpx;
  background: #eef3ff;
  color: #6781ca;
  font-size: 23rpx;
  line-height: 42px;
}

/* 页脚 */
.page-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 34rpx 0 6rpx;
  color: #a7b1c2;
  font-size: 20rpx;
  letter-spacing: 2rpx;
}

.footer-line {
  width: 32rpx;
  height: 1px;
  margin: 0 16rpx;
  background: #dce3ee;
}

/* 窄屏 */
@media screen and (max-width: 350px) {
  .page {
    padding-left: 22rpx;
    padding-right: 22rpx;
  }

  .hero,
  .shortcut-card,
  .ranking-section {
    padding: 24rpx;
  }

  .hero-status,
  .feature-tag {
    display: none;
  }

  .feature-card {
    padding: 20rpx;
  }

  .feature-grid {
    gap: 14rpx;
  }

  .feature-title {
    font-size: 26rpx;
  }

  .rank-number {
    display: none;
  }

  .member-tag {
    display: none;
  }

  .stat-num {
    font-size: 40rpx;
  }

  .section-caption {
    font-size: 18rpx;
  }
}

/* 桌面端保持适当留白 */
@media screen and (min-width: 768px) {
  .page {
    padding: 36px 28px;
  }

  .hero {
    padding: 28px 32px;
  }

  .hero-stats {
    margin: 30px 0 24px;
  }

  .stat-num {
    font-size: 36px;
  }

  .feature-card {
    padding: 24px;
  }
}
</style>
