<template>
  <view class="page">
    <!-- 顶部氛围区 -->
    <view class="hero">
      <view class="hero-orb orb-one"></view>
      <view class="hero-orb orb-two"></view>

      <view class="hero-content">
        <view class="hero-copy">
          <text class="hero-eyebrow">TRIBE LEADERBOARD</text>
          <text class="hero-title">部落荣誉榜</text>
          <text class="hero-desc">每一份贡献，都值得被看见</text>
        </view>
        <view class="hero-emblem">
          <text class="hero-trophy">🏆</text>
        </view>
      </view>

      <view class="hero-bottom">
        <view class="hero-status">
          <view class="status-dot"></view>
          <text>{{ currentBoard ? currentBoard.name : '综合榜' }}</text>
        </view>
        <text class="hero-period">
          {{ type === 'week' ? '每周荣耀 · 实力见证' : '四周积累 · 荣耀进阶' }}
        </text>
      </view>
    </view>

    <!-- 筛选区域 -->
    <view class="filter-card">
      <view class="tabs">
        <view
          v-for="t in tabs"
          :key="t.v"
          class="tab"
          :class="{ on: type === t.v }"
          @click="switchType(t.v)"
        >
          {{ t.label }}
        </view>
      </view>

      <scroll-view scroll-x class="boards" :show-scrollbar="false">
        <view class="scroll-content">
          <view
            class="btab"
            :class="{ on: boardId === null }"
            @click="switchBoard(null)"
          >
            综合榜
          </view>
          <view
            v-for="b in boards"
            :key="b.id"
            class="btab"
            :class="{ on: boardId === b.id }"
            @click="switchBoard(b.id)"
          >
            {{ b.name }}
          </view>
        </view>
      </scroll-view>

      <view class="cycle-heading">
        <text class="section-label">统计周期</text>
        <text class="section-hint">左右滑动切换</text>
      </view>

      <scroll-view scroll-x class="cycles" :show-scrollbar="false">
        <view class="scroll-content">
          <view
            v-for="c in cycles"
            :key="c"
            class="cyc"
            :class="{ on: cycleStart === c }"
            @click="cycleStart = c; load()"
          >
            {{ c }}
          </view>
        </view>
      </scroll-view>

      <view class="switch-row">
        <view class="scope-info">
          <view class="scope-dot" :class="{ muted: includeLeft }"></view>
          <text class="sr-note">
            {{ includeLeft ? '含已离开成员（仅展示）' : '仅统计在部落成员' }}
          </text>
        </view>
        <view
          class="sr-btn"
          :class="{ on: includeLeft }"
          hover-class="button-pressed"
          @click="includeLeft = !includeLeft"
        >
          <text>{{ includeLeft ? '含离开' : '在部落' }}</text>
          <text class="switch-icon">⇄</text>
        </view>
      </view>
    </view>

    <!-- 榜单标题 -->
    <view class="list-heading">
      <view class="heading-left">
        <view class="heading-mark"></view>
        <text class="heading-title">荣耀排行</text>
        <text v-if="!loading" class="member-count">{{ rows.length }} 人</text>
      </view>
      <text class="heading-tip">
        {{ loading ? '正在更新…' : '点击成员查看明细' }}
      </text>
    </view>

    <!-- 排名列表 -->
    <view class="list">
      <view class="list-header">
        <text class="header-rank">排名</text>
        <text class="header-member">部落成员</text>
        <text class="header-score">贡献积分</text>
      </view>

      <!-- 首次加载占位，刷新时保留原列表 -->
      <view v-if="loading && !rows.length" class="skeleton-list">
        <view v-for="n in 5" :key="n" class="skeleton-row">
          <view class="skeleton skeleton-rank"></view>
          <view class="skeleton skeleton-avatar"></view>
          <view class="skeleton-info">
            <view class="skeleton skeleton-name"></view>
            <view class="skeleton skeleton-tag"></view>
          </view>
          <view class="skeleton skeleton-score"></view>
        </view>
      </view>

      <view
        v-for="m in rows"
        :key="m.member_id"
        class="row"
        :class="{
          'row-gold': m.rank === 1,
          'row-silver': m.rank === 2,
          'row-bronze': m.rank === 3
        }"
        hover-class="row-pressed"
        @click="viewDetail(m)"
      >
        <view class="rank-col">
          <view
            class="rank-number"
            :class="{
              'rank-gold': m.rank === 1,
              'rank-silver': m.rank === 2,
              'rank-bronze': m.rank === 3
            }"
          >
            {{ m.rank < 10 ? '0' + m.rank : m.rank }}
          </view>
        </view>

        <view class="avatar-wrap">
          <view
            class="avatar"
            :class="[
              frameClass(m.rank),
              cosmeticFrameClass(cosmetics[m.member_id])
            ]"
          >
            <text class="avatar-txt">{{ firstChar(m.nickname) }}</text>
          </view>
          <text v-if="m.rank >= 1 && m.rank <= 3" class="crown">
            {{ ['👑', '🥈', '🥉'][m.rank - 1] }}
          </text>
        </view>

        <view class="info">
          <view class="name-line">
            <text
              class="name"
              :style="nicknameColorStyle(cosmetics[m.member_id])"
            >
              {{ m.nickname }}
            </text>
            <text v-if="m.status === 2" class="left-tag">离开</text>
          </view>

          <view
            v-if="titleOf(m) || temporaryTitle(cosmetics[m.member_id])"
            class="badge-line"
          >
            <text
              v-if="titleOf(m)"
              class="title"
              :class="'t' + m.rank"
            >
              {{ titleOf(m) }}
            </text>
            <text
              v-if="temporaryTitle(cosmetics[m.member_id])"
              class="tmp-title"
            >
              {{ temporaryTitle(cosmetics[m.member_id]) }}
            </text>
          </view>

          <text class="tag">{{ memberMeta(m) }}</text>
        </view>

        <view class="score-box">
          <text class="score">{{ m.total }}</text>
          <text class="score-label">积分</text>
        </view>
        <text class="row-arrow">›</text>
      </view>

      <!-- 空状态 -->
      <view v-if="!loading && !rows.length" class="empty">
        <view class="empty-icon">🏅</view>
        <text class="empty-title">荣耀席位，虚位以待</text>
        <text class="empty-desc">该周期暂无积分数据，换个周期看看吧</text>
      </view>
    </view>

    <view class="foot-note">
      <text class="foot-title">每一份热爱，都是部落的力量</text>
      <text class="foot-desc">
        名次装饰（称号 / 头像框）仅为展示，不代表奖金变化
      </text>
    </view>
  </view>
</template>

<script>
import { get } from '@/utils/api';
import { navTo } from '@/utils/navigation';
import { setBrowserTitle } from '@/utils/h5';
import { cosmeticMap, frameClass as cosmeticFrameClass, nicknameColorStyle, temporaryTitle } from '@/utils/cosmetics';

// 综合榜前三称号
const OVERALL_TITLES = ['部落之光', '荣耀先锋', '精锐战将'];
// 分项榜第一名专属称号(按规则名关键字匹配)
const BOARD_TITLES = [
  { re: /捐兵|援军/, title: '援军之星' },
  { re: /部落战|三星/, title: '三星战神' },
  { re: /联赛/, title: '联赛王牌' },
  { re: /竞赛/, title: '竞赛达人' },
  { re: /突袭|都城/, title: '突袭先锋' },
];

export default {
  data() {
    return {
      tabs: [
        { v: 'week', label: '周榜' },
        { v: 'month', label: '四周月' },
      ],
      type: 'week',
      boards: [],
      boardId: null, // null = 综合榜
      cycleStart: '',
      cycles: [],
      rows: [],
      includeLeft: false,
      loading: false,
      cosmetics: {},
    };
  },
  computed: {
    currentBoard() {
      return this.boards.find((b) => b.id === this.boardId) || null;
    },
    boardFirstTitle() {
      const b = this.currentBoard;
      if (!b) return '';
      const hit = BOARD_TITLES.find((x) => x.re.test(b.name));
      return hit ? hit.title : `${b.name}第一`;
    },
  },
  watch: {
    includeLeft() {
      this.load();
    },
  },
  onShow() {
    setBrowserTitle();
    this.loadBoards();
    this.loadCycles();
    this.loadCosmetics();
  },
  methods: {
    cosmeticFrameClass,
    nicknameColorStyle,
    temporaryTitle,
    /** 次行资料: 「大本营 14 · 繁荣 63」(原来显示游戏标签) */
    memberMeta(m) {
      if (!m) return '—';
      const th = m.town_hall == null || m.town_hall === '' ? '' : `大本营 ${m.town_hall}`;
      const pr = m.prosperity == null || m.prosperity === '' ? '' : `繁荣 ${m.prosperity}`;
      if (th && pr) return `${th} · ${pr}`;
      return th || pr || '—';
    },
    async loadCosmetics() {
      try {
        this.cosmetics = cosmeticMap(await get('/wheel/cosmetics'));
      } catch (e) {
        this.cosmetics = {};
      }
    },
    firstChar(name) {
      const s = String(name || '?').trim();
      return s ? s.slice(0, 1) : '?';
    },
    frameClass(rank) {
      return rank <= 3 ? `frame-${rank}` : '';
    },
    titleOf(m) {
      if (m.rank > 3) return '';
      if (this.boardId == null) return OVERALL_TITLES[m.rank - 1];
      return m.rank === 1 ? this.boardFirstTitle : '';
    },
    async loadBoards() {
      try {
        this.boards = await get('/ranking/boards');
      } catch (e) {
        this.boards = [];
      }
    },
    switchBoard(id) {
      this.boardId = id;
      this.load();
    },
    async loadCycles() {
      try {
        const res = await get('/ranking/cycles', { type: this.type, limit: 8 });
        this.cycles = res.cycles;
        if (!this.cycleStart || !this.cycles.includes(this.cycleStart)) {
          this.cycleStart = this.cycles[0] || '';
        }
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    },
    async load() {
      if (!this.cycleStart) return;
      this.loading = true;
      try {
        const q = { type: this.type, cycle_start: this.cycleStart, include_left: this.includeLeft ? 1 : 0 };
        if (this.boardId != null) q.rule_id = this.boardId;
        const res = await get('/ranking', q);
        this.rows = res.rows;
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },
    switchType(t) {
      this.type = t;
      this.cycleStart = '';
      this.loadCycles();
    },
    viewDetail(m) {
      const q = [`member_id=${m.member_id}`, `type=${this.type}`, `cycle_start=${this.cycleStart}`];
      if (this.boardId != null) q.push(`rule_id=${this.boardId}`);
      navTo(`/pages/records/records?${q.join('&')}`);
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 28rpx 24rpx 60rpx;
  padding-bottom: calc(60rpx + env(safe-area-inset-bottom));
  background: #f5f6fb;
  color: #25304a;
}

/* 顶部氛围区 */
.hero {
  position: relative;
  overflow: hidden;
  padding: 36rpx 32rpx 62rpx;
  border-radius: 32rpx;
  background: linear-gradient(120deg, #333b83 0%, #5358c8 58%, #7973e6 100%);
  box-shadow: 0 16rpx 40rpx rgba(72, 74, 156, 0.18);
}

.hero-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.orb-one {
  width: 330rpx;
  height: 330rpx;
  top: -170rpx;
  right: -60rpx;
  border: 48rpx solid rgba(255, 255, 255, 0.05);
}

.orb-two {
  width: 190rpx;
  height: 190rpx;
  bottom: -120rpx;
  right: 110rpx;
  background: rgba(255, 255, 255, 0.06);
}

.hero-content,
.hero-bottom {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-copy {
  display: flex;
  flex-direction: column;
}

.hero-eyebrow {
  color: #d2d4ff;
  font-size: 18rpx;
  letter-spacing: 3rpx;
}

.hero-title {
  margin-top: 12rpx;
  color: #fff;
  font-size: 44rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}

.hero-desc {
  margin-top: 12rpx;
  color: #dddfff;
  font-size: 23rpx;
}

.hero-emblem {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 112rpx;
  height: 112rpx;
  margin-left: 16rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.2);
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.1);
  transform: rotate(8deg);
}

.hero-trophy {
  font-size: 64rpx;
  transform: rotate(-8deg);
}

.hero-bottom {
  margin-top: 32rpx;
}

.hero-status {
  display: flex;
  align-items: center;
  max-width: 48%;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
  color: #f2f3ff;
  font-size: 21rpx;
}

.hero-status text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status-dot {
  flex-shrink: 0;
  width: 10rpx;
  height: 10rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #a7f3d0;
}

.hero-period {
  margin-left: 12rpx;
  color: #dddfff;
  font-size: 20rpx;
}

/* 筛选卡片 */
.filter-card {
  position: relative;
  z-index: 2;
  margin: -30rpx 12rpx 0;
  padding: 24rpx;
  border: 2rpx solid #fff;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 36rpx rgba(40, 47, 91, 0.05);
}

.tabs {
  display: flex;
  padding: 7rpx;
  border-radius: 18rpx;
  background: #f1f3f9;
}

.tab {
  flex: 1;
  padding: 16rpx 0;
  border-radius: 13rpx;
  color: #7c8499;
  font-size: 27rpx;
  font-weight: 500;
  text-align: center;
  transition: background 0.2s, color 0.2s;
}

.tab.on {
  background: #fff;
  color: #5356c9;
  font-weight: 700;
  box-shadow: 0 4rpx 12rpx rgba(47, 52, 103, 0.08);
}

.boards,
.cycles {
  width: 100%;
  white-space: nowrap;
}

.boards {
  margin-top: 24rpx;
}

.scroll-content {
  display: inline-block;
  min-width: 100%;
  vertical-align: top;
}

.btab {
  display: inline-block;
  margin-right: 12rpx;
  padding: 13rpx 24rpx;
  border: 2rpx solid #eceef7;
  border-radius: 14rpx;
  background: #f8f9fc;
  color: #747d93;
  font-size: 24rpx;
  transition: background 0.2s, color 0.2s;
}

.btab.on {
  border-color: #5b5ed6;
  background: #5b5ed6;
  color: #fff;
  font-weight: 600;
}

.btab:last-child,
.cyc:last-child {
  margin-right: 0;
}

.cycle-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 26rpx 0 16rpx;
}

.section-label {
  color: #59627a;
  font-size: 23rpx;
  font-weight: 600;
}

.section-hint {
  color: #939bb0;
  font-size: 20rpx;
}

.cyc {
  display: inline-block;
  margin-right: 12rpx;
  padding: 11rpx 18rpx;
  border: 2rpx solid #edf0f6;
  border-radius: 12rpx;
  background: #fff;
  color: #858da1;
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
}

.cyc.on {
  border-color: #d4d5ff;
  background: #f0f0ff;
  color: #5658c6;
  font-weight: 600;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #f2f3f8;
}

.scope-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.scope-dot {
  flex-shrink: 0;
  width: 10rpx;
  height: 10rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #42bd9a;
}

.scope-dot.muted {
  background: #d8a051;
}

.sr-note {
  color: #858da0;
  font-size: 21rpx;
}

.sr-btn {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 9rpx 16rpx;
  border-radius: 10rpx;
  background: #f1f3fa;
  color: #69748d;
  font-size: 21rpx;
}

.sr-btn.on {
  background: #fff4df;
  color: #ad7b27;
}

.switch-icon {
  margin-left: 10rpx;
  font-size: 25rpx;
  line-height: 1;
}

.button-pressed {
  opacity: 0.7;
}

/* 榜单标题 */
.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 34rpx 6rpx 20rpx;
}

.heading-left {
  display: flex;
  align-items: center;
}

.heading-mark {
  width: 7rpx;
  height: 27rpx;
  margin-right: 12rpx;
  border-radius: 999rpx;
  background: #6163d9;
}

.heading-title {
  font-size: 29rpx;
  font-weight: 700;
}

.member-count {
  margin-left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: #eaeaf8;
  color: #7476ac;
  font-size: 20rpx;
}

.heading-tip {
  color: #939bb0;
  font-size: 20rpx;
}

/* 榜单主体 */
.list {
  overflow: hidden;
  border: 2rpx solid #fff;
  border-radius: 26rpx;
  background: #fff;
  box-shadow: 0 8rpx 30rpx rgba(41, 49, 91, 0.035);
}

.list-header {
  display: flex;
  align-items: center;
  padding: 20rpx 22rpx;
  background: #fafbfe;
  color: #939baf;
  font-size: 21rpx;
}

.header-rank {
  width: 64rpx;
  flex-shrink: 0;
}

.header-member {
  flex: 1;
}

.header-score {
  padding-right: 24rpx;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  padding: 28rpx 22rpx;
  border-bottom: 2rpx solid #f3f4f9;
}

.row:last-child {
  border-bottom: none;
}

.row-gold {
  background: linear-gradient(100deg, #fff8e9 0%, #fffdf7 58%, #fff 100%);
}

.row-silver {
  background: linear-gradient(100deg, #f0f4fa 0%, #fafbfd 58%, #fff 100%);
}

.row-bronze {
  background: linear-gradient(100deg, #fcf1e9 0%, #fffaf6 58%, #fff 100%);
}

.row-gold::before,
.row-silver::before,
.row-bronze::before {
  position: absolute;
  top: 30rpx;
  bottom: 30rpx;
  left: 0;
  width: 5rpx;
  border-radius: 0 6rpx 6rpx 0;
  content: '';
}

.row-gold::before {
  background: #e9bd5b;
}

.row-silver::before {
  background: #a9b7cd;
}

.row-bronze::before {
  background: #d4a07d;
}

.row-pressed {
  opacity: 0.72;
}

.rank-col {
  width: 64rpx;
  flex-shrink: 0;
}

.rank-number {
  color: #a3aabd;
  font-size: 29rpx;
  font-weight: 700;
  font-style: italic;
  font-variant-numeric: tabular-nums;
}

.rank-gold {
  color: #c9962f;
}

.rank-silver {
  color: #8394ae;
}

.rank-bronze {
  color: #bc8761;
}

/* 头像与名次装饰 */
.avatar-wrap {
  position: relative;
  flex-shrink: 0;
  margin-right: 18rpx;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 78rpx;
  height: 78rpx;
  box-sizing: border-box;
  border: 4rpx solid #e8eaf6;
  border-radius: 50%;
  background: #f1f2fa;
}

.avatar-txt {
  color: #7a80aa;
  font-size: 30rpx;
  font-weight: 700;
}

.avatar.frame-1 {
  border-color: #eac56e;
  background: linear-gradient(135deg, #fff9de, #f8df9a);
  box-shadow: 0 4rpx 12rpx rgba(206, 157, 52, 0.12);
}

.avatar.frame-1 .avatar-txt {
  color: #a77920;
}

.avatar.frame-2 {
  border-color: #bdc9da;
  background: linear-gradient(135deg, #f9fbff, #dce4ef);
}

.avatar.frame-2 .avatar-txt {
  color: #7386a2;
}

.avatar.frame-3 {
  border-color: #d9ad88;
  background: linear-gradient(135deg, #fff5ec, #efd3b9);
}

.avatar.frame-3 .avatar-txt {
  color: #a3734d;
}

.crown {
  position: absolute;
  top: -20rpx;
  right: -5rpx;
  font-size: 27rpx;
  line-height: 1.2;
}

/* 保留转盘头像框，优先于名次配色 */
.avatar.cos-frame-flame {
  border-color: #ff7a45;
  background: linear-gradient(135deg, #fff1e8, #ffd9c2);
}

.avatar.cos-frame-star {
  border-color: #a78bfa;
  background: linear-gradient(135deg, #f3efff, #ddd2ff);
}

.avatar.cos-frame-jade {
  border-color: #34d399;
  background: linear-gradient(135deg, #e8fff5, #c8f5e2);
}

/* 成员信息 */
.info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.name-line {
  display: flex;
  align-items: center;
  min-width: 0;
}

.name {
  overflow: hidden;
  color: #30384f;
  font-size: 28rpx;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.left-tag {
  flex-shrink: 0;
  margin-left: 8rpx;
  padding: 3rpx 8rpx;
  border-radius: 6rpx;
  background: #eff0f4;
  color: #9399a8;
  font-size: 18rpx;
}

.badge-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 7rpx;
}

.title,
.tmp-title {
  max-width: 100%;
  box-sizing: border-box;
  margin: 0 7rpx 5rpx 0;
  padding: 3rpx 10rpx;
  border-radius: 7rpx;
  font-size: 18rpx;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-all;
}

.title.t1 {
  background: #f9ebc4;
  color: #a77820;
}

.title.t2 {
  background: #e8edf5;
  color: #75859c;
}

.title.t3 {
  background: #f6e4d5;
  color: #a3744e;
}

.tmp-title {
  background: #efebff;
  color: #8a6bc3;
}

.tag {
  overflow: hidden;
  margin-top: 6rpx;
  color: #969eb0;
  font-size: 20rpx;
  white-space: nowrap;
  text-overflow: ellipsis;
  letter-spacing: 1rpx;
}

/* 积分 */
.score-box {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: flex-end;
  margin-left: 14rpx;
}

.score {
  color: #595ccd;
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.row-gold .score {
  color: #bd8a25;
}

.row-silver .score {
  color: #768ba8;
}

.row-bronze .score {
  color: #b47f57;
}

.score-label {
  margin-top: 7rpx;
  color: #a0a7b7;
  font-size: 18rpx;
}

.row-arrow {
  flex-shrink: 0;
  margin-left: 12rpx;
  color: #c5cada;
  font-size: 32rpx;
}

/* 空状态 */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 72rpx 24rpx 82rpx;
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  margin-bottom: 24rpx;
  border-radius: 36rpx;
  background: #f3f2fc;
  font-size: 56rpx;
}

.empty-title {
  color: #69718b;
  font-size: 28rpx;
  font-weight: 600;
}

.empty-desc {
  margin-top: 14rpx;
  color: #a0a6b6;
  font-size: 23rpx;
  text-align: center;
}

/* 加载占位 */
.skeleton-row {
  display: flex;
  align-items: center;
  padding: 30rpx 22rpx;
}

.skeleton {
  border-radius: 8rpx;
  background: #eff1f7;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-rank {
  width: 34rpx;
  height: 28rpx;
  margin-right: 30rpx;
}

.skeleton-avatar {
  flex-shrink: 0;
  width: 78rpx;
  height: 78rpx;
  margin-right: 18rpx;
  border-radius: 50%;
}

.skeleton-info {
  flex: 1;
}

.skeleton-name {
  width: 65%;
  height: 26rpx;
}

.skeleton-tag {
  width: 42%;
  height: 18rpx;
  margin-top: 16rpx;
}

.skeleton-score {
  width: 68rpx;
  height: 34rpx;
  margin-left: 20rpx;
}

@keyframes skeleton-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

/* 底部说明 */
.foot-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 34rpx;
  padding: 0 12rpx;
  text-align: center;
}

.foot-title {
  color: #939ab0;
  font-size: 22rpx;
  letter-spacing: 2rpx;
}

.foot-desc {
  margin-top: 12rpx;
  color: #a7aebe;
  font-size: 20rpx;
  line-height: 1.8;
}
</style>
