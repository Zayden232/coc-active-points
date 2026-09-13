<template>
  <view class="page">
    <!-- 顶部 -->
    <view class="hero">
      <view class="hero-circle"></view>

      <view class="hero-top">
        <view class="hero-copy">
          <text class="eyebrow">TRIBE LUCKY CLUB</text>
          <text class="hero-title">部落幸运屋</text>
          <text class="hero-desc">给今天的部落生活，加一点好运</text>
        </view>
        <view class="hero-icon">🎡</view>
      </view>

      <view class="tabs">
        <view
          class="tab"
          :class="{ on: mode === 'daily' }"
          @click="switchMode('daily')"
        >
          <text class="tab-icon">🎁</text>
          <text>每日奖励</text>
        </view>
        <view
          class="tab"
          :class="{ on: mode === 'fun' }"
          @click="switchMode('fun')"
        >
          <text class="tab-icon">🎯</text>
          <text>随机抽人</text>
        </view>
      </view>
    </view>

    <!-- 每日奖励 -->
    <!-- 注意: 这里只能用带指令的 <block v-if>; 再套一层"不带指令的裸 <block>"会让
         H5 编译器把它编译成真实的 <template> 元素, 而 <template> 的子节点是惰性内容,
         整块内容在浏览器里会完全不渲染(2026-09-13 踩过)。 -->
    <block v-if="mode === 'daily'">
        <!-- 成员选择 -->
        <view class="card member-card">
          <view class="section-heading">
            <view class="heading-left">
              <text class="step">01</text>
              <text class="card-title">为谁送上好运</text>
            </view>
            <text class="small-badge">每日一次</text>
          </view>

          <picker
            :range="memberNames"
            :value="memberIndex < 0 ? 0 : memberIndex"
            :disabled="spinning || membersLoading || !members.length"
            @change="onMemberPick"
          >
            <view class="member-picker">
              <view class="member-avatar">
                {{ firstChar(selectedMember && selectedMember.nickname) }}
              </view>
              <view class="member-info">
                <text class="member-name">
                  {{
                    membersLoading
                      ? '正在加载成员…'
                      : selectedMember
                        ? selectedMember.nickname
                        : '暂无可选成员'
                  }}
                </text>
                <text class="member-sub">
                  {{
                    selectedMember && selectedMember.status === 2
                      ? '已离开部落 · 不可抽奖'
                      : '点击切换成员'
                  }}
                </text>
              </view>
              <text class="picker-arrow">⌄</text>
            </view>
          </picker>

          <view class="member-state">
            <view class="state-dot" :class="{ muted: !canSpin }"></view>
            <text>{{ memberStateText }}</text>
          </view>
        </view>

        <!-- 抽奖舞台 -->
        <view class="card draw-card">
          <view class="stage-heading">
            <text class="stage-eyebrow">A LITTLE LUCK FOR TODAY</text>
            <text class="stage-title">今日好运，即将揭晓</text>
          </view>

          <view class="rule-row">
            <view class="rule-item">
              <text class="rule-value">{{ probabilityText }}</text>
              <text class="rule-label">中奖概率</text>
            </view>
            <view class="rule-divider"></view>
            <view class="rule-item">
              <text class="rule-value">1 次</text>
              <text class="rule-label">每人每天</text>
            </view>
            <view class="rule-divider"></view>
            <view class="rule-item">
              <text class="rule-value">24 小时</text>
              <text class="rule-label">奖励有效期</text>
            </view>
          </view>

          <view class="wheel-stage">
            <view class="stage-glow"></view>

            <view class="wheel-shell">
              <!-- 固定灯珠 -->
              <view
                v-for="n in 16"
                :key="n"
                class="bulb"
                :class="{ 'bulb-alt': n % 2 === 0 }"
                :style="bulbStyle(n)"
              ></view>

              <!-- 只有盘面转动 -->
              <view
                class="wheel-face"
                :style="{
                  transform: 'rotate(' + rotation + 'deg)',
                  transition: spinning
                    ? 'transform 3.2s cubic-bezier(.12,.72,.12,1)'
                    : 'none'
                }"
              >
                <view
                  v-for="(s, i) in sectors"
                  :key="i"
                  class="sector"
                  :style="sectorStyle(i)"
                >
                  <view
                    class="sector-content"
                    :style="{
                      transform: 'rotate(' + (-sectorAngle(i)) + 'deg)'
                    }"
                  >
                    <text class="sector-icon">{{ s.icon }}</text>
                    <text
                      class="sector-text"
                      :class="{ 'sector-none': s.key === 'none' }"
                    >
                      {{ s.short }}
                    </text>
                  </view>
                </view>
              </view>

              <!-- 固定中心装饰，不跟随盘面旋转 -->
              <view class="wheel-hub">
                <text class="hub-icon">✦</text>
                <text class="hub-text">好运</text>
              </view>

              <!-- 固定指针：尖端指向盘面 -->
              <view class="wheel-pointer">
                <view class="pointer-dot"></view>
                <view class="pointer-tip"></view>
              </view>
            </view>

            <view class="wheel-shadow"></view>
          </view>

          <button
            class="primary-btn"
            :class="{ 'busy-btn': spinning }"
            :disabled="!canSpin"
            @click="doSpin"
          >
            {{ spinButtonText }}
          </button>

          <text class="stage-note">
            {{ spinning ? '好运正在路上，请稍候…' : '奖励用于排行榜外观展示，不影响积分与奖金' }}
          </text>

          <!-- 结果 -->
          <view
            v-if="result"
            class="result-card"
            :class="{ 'result-win': result.win }"
          >
            <view class="result-icon">{{ result.win ? '🎉' : '🍀' }}</view>
            <view class="result-copy">
              <text class="result-kicker">
                {{ result.already ? '今日已抽取 · 历史结果' : '本次抽奖结果' }}
              </text>
              <text class="result-title">
                {{
                  result.win
                    ? '获得 · ' + result.reward.label
                    : '这次与好运擦肩而过'
                }}
              </text>
              <text class="result-desc">
                {{
                  result.already
                    ? '不会重复发奖，生效情况请查看下方外观列表'
                    : result.win
                      ? '奖励已发放，24 小时内可在排行榜展示'
                      : '今天的贡献同样闪耀，明天再来试试吧'
                }}
              </text>
            </view>
          </view>
        </view>

        <!-- 生效外观 -->
        <view v-if="cosmetics.length" class="card">
          <view class="section-heading">
            <view class="heading-left">
              <text class="heading-symbol">✦</text>
              <text class="card-title">正在闪耀</text>
            </view>
            <text class="section-extra">{{ cosmetics.length }} 件生效中</text>
          </view>

          <view v-for="c in cosmetics" :key="c.id" class="cos-row">
            <view class="cos-icon">{{ cosmeticIcon(c) }}</view>
            <view class="cos-info">
              <text class="cos-label">{{ c.label }}</text>
              <text class="cos-expiry">{{ c.expires_at }} 到期</text>
            </view>
            <text class="active-tag">生效中</text>
          </view>
        </view>

        <!-- 奖励池：仍使用后端返回内容 -->
        <view class="card">
          <view class="section-heading">
            <view class="heading-left">
              <text class="heading-symbol">🎁</text>
              <text class="card-title">好运奖励池</text>
            </view>
            <text class="section-extra">限时外观</text>
          </view>

          <view v-if="pool.length" class="pool">
            <view v-for="p in pool" :key="p.key" class="pool-item">
              <view class="pool-icon">{{ rewardIcon(p.key) }}</view>
              <text class="pool-label">{{ p.label }}</text>
              <text class="pool-duration">24 小时体验</text>
            </view>
          </view>
          <text v-else class="empty-tip">
            {{ statusLoading ? '奖励池加载中…' : '选择成员后查看奖励池' }}
          </text>

          <view class="fair-note">
            <text class="fair-icon">ⓘ</text>
            <text>抽奖结果由服务端判定，扇区仅作展示，不代表等概率。</text>
          </view>
        </view>
    </block>

    <!-- 随机抽人 -->
    <block v-else>
      <view class="card fun-card">
        <view class="section-heading">
          <view class="heading-left">
            <text class="heading-symbol">🎯</text>
            <text class="card-title">今天，谁是幸运成员</text>
          </view>
        </view>

        <!-- 参与名单来源: 按状态分组 / 自选成员 -->
        <view class="pick-tabs">
          <view
            class="pick-tab"
            :class="{ on: pickMode === 'scope' }"
            @click="switchPickMode('scope')"
          >
            <text>按分组</text>
          </view>
          <view
            class="pick-tab"
            :class="{ on: pickMode === 'custom' }"
            @click="switchPickMode('custom')"
          >
            <text>自选成员</text>
          </view>
        </view>

        <block v-if="pickMode === 'scope'">
          <view class="scope-tabs">
            <view
              v-for="f in scopes"
              :key="f.v"
              class="scope-tab"
              :class="{ on: scope === f.v }"
              @click="switchScope(f.v)"
            >
              <view
                class="scope-dot"
                :class="{
                  green: f.v === 0,
                  red: f.v === 1
                }"
              ></view>
              <text>{{ f.label }}</text>
            </view>
          </view>
        </block>

        <block v-else>
          <view class="pick-panel">
            <view class="pick-head">
              <text class="pick-count">
                已选 {{ pickedCount }} / {{ pickTotal }} 人
              </text>
              <view class="pick-actions">
                <text class="pick-action" @click="loadScores">刷新</text>
                <text class="pick-action" @click="pickAll">全选</text>
                <text
                  class="pick-action"
                  :class="{ off: !pickedCount }"
                  @click="clearPicks"
                >
                  清空
                </text>
              </view>
            </view>

            <text v-if="scoreError" class="pick-tip error-tip">
              分数加载失败（{{ scoreError }}）：下面是未分组的名单，可点「刷新」重试
            </text>
            <text v-else-if="scoreLoading" class="pick-tip">
              正在加载本周分数…
            </text>
            <text v-else class="pick-tip">
              按本周分数分组，同分的人在一组 —— 点分数那一行可整组选中
            </text>

            <view v-for="g in pickGroups" :key="g.key" class="score-group">
              <view class="score-head" @click="toggleGroup(g)">
                <text class="score-value" :class="{ zero: !g.score }">
                  {{ g.score === null ? '未分组' : g.score + ' 分' }}
                </text>
                <text class="score-meta">
                  第 {{ g.from }}{{ g.from === g.to ? '' : '–' + g.to }} 名 · {{ g.members.length }} 人{{
                    g.score > 0 && g.members.length > 1 ? ' · 并列' : ''
                  }}
                </text>
                <text class="score-pick" :class="{ on: isGroupPicked(g) }">
                  {{ isGroupPicked(g) ? '取消本组' : '整组选中' }}
                </text>
              </view>

              <view class="pick-grid">
                <view
                  v-for="m in g.members"
                  :key="m.id"
                  class="pick-item"
                  :class="{ on: isPicked(m.id) }"
                  @click="togglePick(m.id)"
                >
                  <text class="pick-mark">{{ isPicked(m.id) ? '✓' : '+' }}</text>
                  <text class="pick-name">{{ m.nickname }}</text>
                </view>
              </view>
            </view>

            <text v-if="!pickGroups.length" class="empty-tip">
              {{ membersLoading ? '正在加载成员…' : '暂时没有可选成员' }}
            </text>
          </view>
        </block>

        <view class="fun-stage" :class="{ 'fun-running': running }">
          <view class="fun-orbit orbit-one"></view>
          <view class="fun-orbit orbit-two"></view>

          <text class="fun-eyebrow">
            {{ running ? '好运搜索中…' : funResult ? '幸运成员已诞生' : 'LUCKY MEMBER' }}
          </text>
          <view class="fun-avatar">
            {{ funDisplay ? firstChar(funDisplay) : '?' }}
          </view>
          <text class="fun-name">{{ funDisplay || '下一位，会是谁？' }}</text>
          <text class="fun-caption">
            {{ funCaption }}
          </text>
        </view>

        <button
          class="primary-btn"
          :disabled="running || membersLoading || !funMembers.length"
          @click="runFun"
        >
          {{ running ? '正在寻找幸运成员…' : funResult ? '再抽一次' : '开始随机抽取' }}
        </button>

        <view v-if="funResult" class="fun-result">
          <text>🎉 本次抽中</text>
          <text class="fun-result-name">{{ funResult }}</text>
        </view>
      </view>

      <view class="card">
        <view class="section-heading">
          <view class="heading-left">
            <text class="card-title">参与名单</text>
            <text class="count-badge">{{ funMembers.length }}</text>
          </view>
          <text class="section-extra">好运不分先后</text>
        </view>

        <view class="chips">
          <view
            v-for="m in funMembers"
            :key="m.id"
            class="chip"
            :class="{ 'chip-selected': funResultId === m.id }"
          >
            <text v-if="funResultId === m.id" class="chip-star">✦</text>
            <text>{{ m.nickname }}</text>
          </view>
        </view>

        <text v-if="!funMembers.length" class="empty-tip">
          {{ funEmptyTip }}
        </text>

        <view class="fair-note">
          <text class="fair-icon">ⓘ</text>
          <text>纯娱乐：不写积分、不发奖励，每次独立抽取，可重复抽到同一人。</text>
        </view>
      </view>
    </block>

    <view class="footer">
      <text class="footer-star">✦</text>
      <text>愿每一份热爱，都能遇见好运</text>
      <text class="footer-star">✦</text>
    </view>
  </view>
</template>

<script>
import { get, post } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';

// 只调整展示文案与图标，保持原奖励 key 和排列不变。
const SECTORS = [
  { short: '谢谢参与', key: 'none', icon: '🍀' },
  { short: '烈焰框', key: 'frame_flame', icon: '🔥' },
  { short: '紫昵称', key: 'color_purple', icon: '💜' },
  { short: '星光框', key: 'frame_star', icon: '🌟' },
  { short: '谢谢参与', key: 'none', icon: '🍀' },
  { short: '幸运星', key: 'title_lucky', icon: '🏅' },
  { short: '金昵称', key: 'color_gold', icon: '✨' },
  { short: '翡翠框', key: 'frame_jade', icon: '💎' },
];

const SECTOR_DEG = 360 / SECTORS.length;

export default {
  data() {
    return {
      mode: 'daily',
      members: [],
      membersLoading: false,
      memberIndex: -1,
      status: null,
      statusLoading: false,
      cosmetics: [],
      pool: [],
      result: null,
      spinning: false,
      rotation: 0,
      sectors: SECTORS,

      scopes: [
        { v: -2, label: '在部落' },
        { v: 0, label: '绿牌' },
        { v: 1, label: '红牌' },
      ],
      scope: -2,
      // 随机抽人的参与名单来源: 'scope' 按状态分组 | 'custom' 自选成员(按本周分数分组)
      pickMode: 'scope',
      // 自选成员(存 id 数组, 数组在 Vue3 里天然可响应; 顺序按 members 原顺序过滤, 名单稳定)
      pickedIds: [],
      // 本周排行榜(自选面板按它分组: 同分的人排在一组)
      scoreRows: [],
      scoreLoading: false,
      scoreError: '',
      scoresLoaded: false,
      funDisplay: '',
      funResult: '',
      funResultId: null,
      running: false,
    };
  },

  created() {
    this._disposed = false;
    this._statusSeq = 0;
    this._memberSeq = 0;
    this._spinTimer = null;
    this._funTimer = null;
  },

  computed: {
    memberNames() {
      return this.members.map((m) =>
        m.status === 2 ? `${m.nickname}（已离开）` : m.nickname
      );
    },

    selectedMember() {
      return this.members[this.memberIndex] || null;
    },

    probabilityText() {
      // 不使用 ||，避免服务端返回 0 时错误显示 45%。
      const value =
        this.status && this.status.probability != null
          ? Number(this.status.probability)
          : 0.45;
      return `${Math.round(value * 100)}%`;
    },

    // 每日奖励对所有人开放(含未登录访客): 每个成员每天只能领一次,
    // 服务端用 wheel_spins 的唯一键保证幂等, 奖励只影响排行榜外观。
    canSpin() {
      return !!(
        !this.membersLoading &&
        !this.statusLoading &&
        !this.spinning &&
        this.selectedMember &&
        this.selectedMember.status !== 2 &&
        this.status &&
        this.status.can_draw
      );
    },

    memberStateText() {
      if (this.membersLoading) return '正在加载成员信息';
      if (!this.selectedMember) return '暂无可选成员';
      if (this.selectedMember.status === 2) return '已离开成员不可参与每日抽奖';
      if (this.spinning) return '正在为该成员揭晓好运';
      if (this.statusLoading) return '正在查询今日抽奖资格';
      if (!this.status) return '状态加载失败，可重新选择成员重试';
      return this.status.can_draw
        ? '今日机会尚未使用，准备迎接好运'
        : '该成员今日已抽取，明天再来';
    },

    spinButtonText() {
      if (this.spinning) return '好运转动中…';
      if (this.membersLoading || this.statusLoading) return '正在准备…';
      if (!this.selectedMember) return '暂无可选成员';
      if (this.selectedMember.status === 2) return '已离开成员不可抽奖';
      if (!this.status) return '等待抽奖状态';
      if (!this.status.can_draw) return '今日已抽取 · 明天再来';
      return '开启今日好运';
    },

    // 按分组时参与的人
    scopedMembers() {
      return this.members.filter((m) => {
        if (this.scope === -2) return m.status !== 2;
        return m.status === this.scope;
      });
    },

    // 自选时参与的人: 跟着分数分组的顺序(高分在前), 与面板上看到的顺序一致
    pickedMembers() {
      return this.pickGroups
        .reduce((all, g) => all.concat(g.members), [])
        .filter((m) => this.pickedIds.includes(m.id));
    },

    pickedCount() {
      return this.pickedMembers.length;
    },

    // 自选面板的分组: 按本周分数从高到低, 同分的人合成一组(名次区间一起给出来)
    // 拿不到排行榜时退化成"不分组"的一份名单, 至少还能选人
    pickGroups() {
      const rows = this.scoreRows.length
        ? this.scoreRows
        : this.members.map((m) => ({ id: m.id, nickname: m.nickname, score: null }));

      const byScore = new Map();
      for (const row of rows) {
        const key = row.score === null ? '__none__' : row.score;
        if (!byScore.has(key)) byScore.set(key, []);
        byScore.get(key).push(row);
      }

      const keys = [...byScore.keys()].sort((a, b) => {
        if (a === '__none__') return 1;
        if (b === '__none__') return -1;
        return b - a;
      });

      let cursor = 0;
      return keys.map((key) => {
        const groupRows = byScore.get(key);
        const group = {
          key: String(key),
          score: key === '__none__' ? null : Number(key),
          members: groupRows,
          ids: groupRows.map((r) => r.id),
          from: cursor + 1,
          to: cursor + groupRows.length,
        };
        cursor += groupRows.length;
        return group;
      });
    },

    // 自选面板的总人数(用于"已选 N / M 人")
    pickTotal() {
      return this.pickGroups.reduce((sum, g) => sum + g.ids.length, 0);
    },

    // 抽取逻辑只认 funMembers: 分组/自选两种来源在这里合流, runFun 不需要分情况
    funMembers() {
      return this.pickMode === 'custom' ? this.pickedMembers : this.scopedMembers;
    },

    funCaption() {
      if (this.pickMode === 'custom' && !this.funMembers.length) {
        return '还没选人：先在上面挑几位成员';
      }
      return `共 ${this.funMembers.length} 位成员参与 · 让好运来决定`;
    },

    funEmptyTip() {
      if (this.membersLoading) return '正在加载成员…';
      if (this.pickMode === 'custom') {
        if (this.scoreLoading) return '正在加载本周分数…';
        return this.pickTotal
          ? '还没选择成员：点上面的成员卡片，或点分数整组选中'
          : '暂时没有可选的成员';
      }
      return '该分组暂无成员，换个分组试试';
    },
  },

  onShow() {
    setBrowserTitle();

    // 转动期间不刷新成员，避免动画对应的成员被改变。
    if (!this.spinning) this.loadMembers();

    // 停在"自选成员"标签时, 每次回到页面都重新拉一次本周分数:
    // 结算前大家还在录分, 分数一变"谁跟谁并列"就变了, 用旧数据选人会选错。
    if (this.pickMode === 'custom' && !this.running) this.loadScores();
  },

  onHide() {
    this.stopFun();
  },

  onUnload() {
    this._disposed = true;
    this._statusSeq += 1;
    this._memberSeq += 1;
    clearTimeout(this._spinTimer);
    this.stopFun();
  },

  methods: {
    firstChar(name) {
      const chars = Array.from(String(name || '').trim());
      return chars[0] || '?';
    },

    switchMode(mode) {
      if (mode === this.mode) return;

      if (this.spinning || this.running) {
        uni.showToast({ title: '请等待本次抽取结束', icon: 'none' });
        return;
      }

      this.mode = mode;
    },

    switchScope(value) {
      if (this.running || value === this.scope) return;
      this.scope = value;
      this.resetFunResult();
    },

    // 切"按分组 / 自选成员": 名单换了就把上一次结果清掉, 免得出现"抽中的人不在名单里"
    async switchPickMode(value) {
      if (this.running || value === this.pickMode) return;
      this.pickMode = value;
      this.resetFunResult();

      // 自选面板按"本周分数"分组, 所以第一次进来要先把周榜拉回来
      if (value === 'custom' && !this.scoresLoaded) await this.loadScores();
    },

    /**
     * 拉本周排行榜, 供自选面板按分数分组。
     * 用途: 每周奖励只有一份, 但经常多人同分 —— 这里就是给"从并列的人里抽一个"用的。
     * 拿不到分数不算致命: 退化成不分组的名字列表, 照样能选人(见 pickGroups)。
     */
    async loadScores() {
      if (this.scoreLoading) return;

      this.scoreLoading = true;
      this.scoreError = '';

      try {
        const data = await get('/ranking?type=week');
        const rows = data && Array.isArray(data.rows) ? data.rows : [];
        this.scoreRows = rows.map((row) => ({
          id: row.member_id,
          nickname: row.nickname,
          score: Number(row.total) || 0,
        }));
        this.scoresLoaded = true;
      } catch (e) {
        this.scoreRows = [];
        this.scoresLoaded = false;
        this.scoreError = (e && e.message) || '分数加载失败';
      } finally {
        this.scoreLoading = false;

        // 名单换了以后, 把"已经不在名单里"的勾选丢掉(例如某人已离开、已不在榜上),
        // 否则它会一直挂在 pickedIds 里, 计数对不上, 以后再出现时还会莫名其妙被选中。
        const valid = new Set(this.pickGroups.reduce((all, g) => all.concat(g.ids), []));
        this.pickedIds = this.pickedIds.filter((id) => valid.has(id));
      }
    },

    resetFunResult() {
      this.funDisplay = '';
      this.funResult = '';
      this.funResultId = null;
    },

    isPicked(id) {
      return this.pickedIds.includes(id);
    },

    togglePick(id) {
      if (this.running || id == null) return;

      this.pickedIds = this.pickedIds.includes(id)
        ? this.pickedIds.filter((item) => item !== id)
        : this.pickedIds.concat(id);

      this.resetFunResult();
    },

    /** 这一组是不是已经全被选中 */
    isGroupPicked(group) {
      return !!group && group.ids.length > 0 && group.ids.every((id) => this.pickedIds.includes(id));
    },

    /** 整组选中 / 取消整组 —— 同分并列的人一次点完 */
    toggleGroup(group) {
      if (this.running || !group || !group.ids.length) return;

      if (this.isGroupPicked(group)) {
        this.pickedIds = this.pickedIds.filter((id) => !group.ids.includes(id));
      } else {
        this.pickedIds = Array.from(new Set(this.pickedIds.concat(group.ids)));
      }

      this.resetFunResult();
    },

    pickAll() {
      if (this.running) return;
      this.pickedIds = this.pickGroups.reduce((all, g) => all.concat(g.ids), []);
      this.resetFunResult();
    },

    clearPicks() {
      if (this.running || !this.pickedIds.length) return;
      this.pickedIds = [];
      this.resetFunResult();
    },

    async loadMembers() {
      const seq = ++this._memberSeq;
      const previousId = this.selectedMember
        ? this.selectedMember.id
        : null;

      this.membersLoading = true;

      try {
        const list = await get('/members');
        if (this._disposed || seq !== this._memberSeq) return;

        // 保留完整名单，娱乐模式自行按状态筛选。
        this.members = Array.isArray(list) ? list : [];

        let index = this.members.findIndex((m) => m.id === previousId);
        if (index < 0) {
          index = this.members.findIndex((m) => m.status !== 2);
        }
        if (index < 0 && this.members.length) index = 0;

        this.memberIndex = index;

        const currentId = this.selectedMember
          ? this.selectedMember.id
          : null;
        if (currentId !== previousId) this.result = null;

        await this.loadStatus();
      } catch (e) {
        if (!this._disposed && seq === this._memberSeq) {
          this._statusSeq += 1;
          this.status = null;
          this.cosmetics = [];
          this.pool = [];
          this.statusLoading = false;
          uni.showToast({
            title: e.message || '成员加载失败',
            icon: 'none',
          });
        }
      } finally {
        if (!this._disposed && seq === this._memberSeq) {
          this.membersLoading = false;
        }
      }
    },

    onMemberPick(e) {
      if (this.spinning || this.membersLoading) return;
      this.memberIndex = Number(e.detail.value);
      this.result = null;
      this.loadStatus();
    },

    async loadStatus() {
      const seq = ++this._statusSeq;
      const member = this.selectedMember;

      // 切成员后立即清空旧资格，避免拿上一个成员的状态点击抽奖。
      this.status = null;
      this.cosmetics = [];
      this.pool = [];
      this.statusLoading = false;

      if (!member) return;

      this.statusLoading = true;

      try {
        const st = await get('/wheel/status', {
          member_id: member.id,
        });

        if (this._disposed || seq !== this._statusSeq) return;

        this.status = st;
        this.cosmetics = st.cosmetics || [];
        this.pool = st.pool || [];
      } catch (e) {
        if (!this._disposed && seq === this._statusSeq) {
          uni.showToast({
            title: e.message || '抽奖状态加载失败',
            icon: 'none',
          });
        }
      } finally {
        if (!this._disposed && seq === this._statusSeq) {
          this.statusLoading = false;
        }
      }
    },

    sectorAngle(index) {
      return index * SECTOR_DEG + SECTOR_DEG / 2;
    },

    sectorStyle(index) {
      return {
        transform:
          `rotate(${this.sectorAngle(index)}deg) translateY(-148rpx)`,
      };
    },

    bulbStyle(n) {
      return {
        transform: `rotate(${(n - 1) * 22.5}deg) translateY(-230rpx)`,
      };
    },

    rewardIcon(key) {
      const sector = SECTORS.find((s) => s.key === key);
      return sector ? sector.icon : '🎁';
    },

    cosmeticIcon(c) {
      if (c.kind === 'frame') {
        return this.rewardIcon(`frame_${c.value}`);
      }
      if (c.kind === 'nickname_color') {
        return this.rewardIcon(`color_${c.value}`);
      }
      if (c.kind === 'title') return '🏅';
      return '✦';
    },

    targetIndexFor(result) {
      if (result && result.win) {
        // 不认识的中奖 key 不伪装成“谢谢参与”。
        return SECTORS.findIndex(
          (s) => result.reward && s.key === result.reward.key
        );
      }

      const indices = SECTORS
        .map((s, i) => (s.key === 'none' ? i : -1))
        .filter((i) => i >= 0);

      return indices[Math.floor(Math.random() * indices.length)];
    },

    normalizeResult(res) {
      if (res.already) {
        const spin = res.spin || {};
        return {
          already: true,
          win: !!spin.reward_key && spin.reward_key !== 'none',
          reward: {
            key: spin.reward_key,
            label: spin.reward_label || '幸运奖励',
          },
        };
      }

      return {
        ...res,
        win: !!res.win,
        reward: res.reward || { label: '幸运奖励' },
      };
    },

    async doSpin() {
      if (!this.canSpin) return;

      const memberId = this.selectedMember.id;
      this.spinning = true;
      this.result = null;

      try {
        // 服务端先判定，前端动画只负责展示。
        const res = await post('/wheel/spin', {
          member_id: memberId,
        });
        if (this._disposed) return;

        const normalized = this.normalizeResult(res);

        // 重复请求直接展示历史结果，不播放一次假的抽奖。
        if (normalized.already) {
          this.result = normalized;
          await this.loadStatus();
          if (!this._disposed) this.spinning = false;
          return;
        }

        const index = this.targetIndexFor(normalized);

        // 奖励池未来若扩展但盘面未同步，仍展示真实结果。
        if (index < 0) {
          this.result = normalized;
          await this.loadStatus();
          if (!this._disposed) this.spinning = false;
          return;
        }

        // 扇区中心旋转到十二点方向，与固定指针严格对齐。
        const targetAngle = -this.sectorAngle(index);
        const current = ((this.rotation % 360) + 360) % 360;
        const delta = ((targetAngle - current) % 360 + 360) % 360;

        this.rotation += 360 * 5 + delta;

        clearTimeout(this._spinTimer);
        this._spinTimer = setTimeout(() => {
          this._spinTimer = null;
          if (this._disposed) return;

          this.result = normalized;

          // 先清除旧资格，再解锁按钮。
          this.loadStatus();
          this.spinning = false;
        }, 3300);
      } catch (e) {
        if (this._disposed) return;

        uni.showToast({
          title: e.message || '抽奖失败，请检查状态后重试',
          icon: 'none',
        });

        // 网络失败不等于后端没有发奖，重新查询今日资格。
        await this.loadStatus();
        if (!this._disposed) this.spinning = false;
      }
    },

    runFun() {
      if (this.running || this.membersLoading || !this.funMembers.length) {
        return;
      }

      // 固定本次参与快照，不受后续名单变化影响。
      const candidates = this.funMembers.slice();
      const winner = candidates[Math.floor(Math.random() * candidates.length)];

      this.running = true;
      this.funResult = '';
      this.funResultId = null;

      let ticks = 0;

      const tick = () => {
        if (this._disposed) return;

        ticks += 1;
        const current =
          candidates[Math.floor(Math.random() * candidates.length)];
        this.funDisplay = current.nickname;

        if (ticks >= 22) {
          this.funDisplay = winner.nickname;
          this.funResult = winner.nickname;
          this.funResultId = winner.id;
          this.running = false;
          this._funTimer = null;
          return;
        }

        // 先快后慢，增强揭晓感；不改变最终抽取概率。
        const delay = ticks < 14 ? 65 : 90 + (ticks - 14) * 22;
        this._funTimer = setTimeout(tick, delay);
      };

      tick();
    },

    stopFun() {
      clearTimeout(this._funTimer);
      this._funTimer = null;

      if (this.running) {
        this.running = false;
        this.funDisplay = '';
        this.funResult = '';
        this.funResultId = null;
      }
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24rpx 24rpx 48rpx;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
  background: #f5f6fb;
  color: #30364e;
}

/* 顶部 */
.hero {
  position: relative;
  overflow: hidden;
  padding: 34rpx 28rpx 24rpx;
  margin-bottom: 24rpx;
  border-radius: 30rpx;
  background: linear-gradient(120deg, #343b82, #5a58c7 65%, #8076e4);
  box-shadow: 0 12rpx 32rpx rgba(67, 63, 142, .16);
}
.hero-circle {
  position: absolute;
  width: 260rpx;
  height: 260rpx;
  top: -130rpx;
  right: -100rpx;
  border: 48rpx solid rgba(255, 255, 255, .06);
  border-radius: 50%;
}
.hero-top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hero-copy {
  display: flex;
  flex-direction: column;
}
.eyebrow {
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: #d7d4ff;
}
.hero-title {
  margin-top: 12rpx;
  font-size: 42rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: #fff;
}
.hero-desc {
  margin-top: 12rpx;
  font-size: 23rpx;
  color: #dfddff;
}
.hero-icon {
  flex-shrink: 0;
  margin-left: 12rpx;
  font-size: 80rpx;
}
.tabs {
  position: relative;
  display: flex;
  margin-top: 30rpx;
  padding: 7rpx;
  border: 2rpx solid rgba(255, 255, 255, .13);
  border-radius: 18rpx;
  background: rgba(30, 29, 87, .18);
}
.tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 17rpx 0;
  border-radius: 13rpx;
  font-size: 26rpx;
  color: #e0ddff;
}
.tab.on {
  background: #fff;
  color: #5554b8;
  font-weight: 700;
  box-shadow: 0 4rpx 12rpx rgba(31, 28, 91, .12);
}
.tab-icon {
  margin-right: 10rpx;
  font-size: 26rpx;
}

/* 通用卡片 */
.card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid #fff;
  border-radius: 26rpx;
  background: #fff;
  box-shadow: 0 8rpx 28rpx rgba(43, 48, 90, .035);
}
.section-heading,
.heading-left {
  display: flex;
  align-items: center;
}
.section-heading {
  justify-content: space-between;
  margin-bottom: 22rpx;
}
.card-title {
  font-size: 28rpx;
  font-weight: 700;
}
.heading-symbol {
  margin-right: 12rpx;
  font-size: 28rpx;
  color: #7670ce;
}
.section-extra {
  margin-left: 10rpx;
  font-size: 21rpx;
  color: #969caf;
}
.step {
  margin-right: 12rpx;
  color: #9893d4;
  font-size: 25rpx;
  font-weight: 800;
  font-style: italic;
}
.small-badge {
  padding: 6rpx 12rpx;
  border-radius: 8rpx;
  background: #f1effc;
  color: #8278bb;
  font-size: 19rpx;
}

/* 成员选择 */
.member-picker {
  display: flex;
  align-items: center;
  padding: 20rpx;
  border: 2rpx solid #e9e8f4;
  border-radius: 18rpx;
  background: #fafaff;
}
.member-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 72rpx;
  height: 72rpx;
  margin-right: 18rpx;
  border-radius: 22rpx;
  background: linear-gradient(135deg, #e6e3ff, #f0edff);
  color: #7568bd;
  font-size: 32rpx;
  font-weight: 700;
}
.member-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.member-name {
  overflow: hidden;
  font-size: 29rpx;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.member-sub {
  margin-top: 7rpx;
  color: #999db0;
  font-size: 21rpx;
}
.picker-arrow {
  margin-left: 16rpx;
  color: #9792b6;
  font-size: 34rpx;
}
.member-state {
  display: flex;
  align-items: center;
  margin-top: 18rpx;
  color: #8c93a6;
  font-size: 21rpx;
  line-height: 1.6;
}
.state-dot {
  flex-shrink: 0;
  width: 10rpx;
  height: 10rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #4abd99;
}
.state-dot.muted {
  background: #c7b17e;
}

/* 抽奖舞台 */
.draw-card {
  overflow: hidden;
  padding-top: 30rpx;
  background: linear-gradient(180deg, #fffdf8 0%, #fff 55%);
}
.stage-heading {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stage-eyebrow {
  color: #b4a184;
  font-size: 17rpx;
  letter-spacing: 3rpx;
}
.stage-title {
  margin-top: 12rpx;
  color: #4a4262;
  font-size: 33rpx;
  font-weight: 800;
}
.rule-row {
  display: flex;
  align-items: center;
  padding: 20rpx 6rpx;
  margin-top: 24rpx;
  border: 2rpx solid #f5eddf;
  border-radius: 18rpx;
  background: rgba(255, 249, 237, .7);
}
.rule-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
}
.rule-value {
  font-size: 26rpx;
  color: #a07a39;
  font-weight: 700;
}
.rule-label {
  margin-top: 7rpx;
  font-size: 19rpx;
  color: #ab9d86;
}
.rule-divider {
  width: 2rpx;
  height: 40rpx;
  background: #eee4d2;
}
.wheel-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 34rpx;
  padding-bottom: 16rpx;
}
.stage-glow {
  position: absolute;
  top: 12rpx;
  width: 560rpx;
  height: 530rpx;
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    rgba(237, 218, 174, .34),
    rgba(237, 218, 174, 0) 70%
  );
}
.wheel-shell {
  position: relative;
  width: 480rpx;
  height: 480rpx;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 24rpx;
  border-radius: 50%;
  background: linear-gradient(145deg, #f8dda0, #cb974c 50%, #edc87c);
  box-shadow:
    0 9rpx 0 #b68748,
    0 16rpx 30rpx rgba(142, 102, 46, .2),
    inset 0 2rpx 4rpx rgba(255, 255, 255, .8);
}
.wheel-face {
  position: relative;
  width: 432rpx;
  height: 432rpx;
  border-radius: 50%;
  background: conic-gradient(
    #f0effa 0deg 45deg,
    #fff0d9 45deg 90deg,
    #eee6fc 90deg 135deg,
    #fff6df 135deg 180deg,
    #f0effa 180deg 225deg,
    #ffeadb 225deg 270deg,
    #fff5cd 270deg 315deg,
    #e3f4ec 315deg 360deg
  );
  box-shadow: inset 0 0 0 4rpx rgba(255, 255, 255, .85);
}
.bulb {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 10rpx;
  height: 10rpx;
  margin-top: -5rpx;
  margin-left: -5rpx;
  border-radius: 50%;
  background: #fff9df;
  box-shadow: 0 0 8rpx rgba(255, 251, 220, .8);
}
.bulb-alt {
  background: #ffe8ab;
}
.sector {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 96rpx;
  height: 72rpx;
  margin-top: -36rpx;
  margin-left: -48rpx;
  transform-origin: center center;
}
.sector-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.sector-icon {
  font-size: 31rpx;
  line-height: 1.2;
}
.sector-text {
  margin-top: 7rpx;
  color: #695271;
  font-size: 20rpx;
  font-weight: 700;
  white-space: nowrap;
}
.sector-none {
  color: #9390a8;
}
.wheel-hub {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  width: 114rpx;
  height: 114rpx;
  box-sizing: border-box;
  margin-top: -57rpx;
  margin-left: -57rpx;
  border: 7rpx solid #ffe9b5;
  border-radius: 50%;
  background: linear-gradient(145deg, #8073cb, #53478f);
  box-shadow: 0 5rpx 14rpx rgba(75, 54, 114, .22);
}
.hub-icon {
  color: #ffe5a0;
  font-size: 34rpx;
  line-height: 1;
}
.hub-text {
  margin-top: 5rpx;
  color: #fff2cf;
  font-size: 24rpx;
  font-weight: 700;
  letter-spacing: 3rpx;
}
.wheel-pointer {
  position: absolute;
  z-index: 5;
  top: -12rpx;
  left: 50%;
  width: 40rpx;
  margin-left: -20rpx;
}
.pointer-dot {
  position: relative;
  z-index: 1;
  width: 36rpx;
  height: 36rpx;
  box-sizing: border-box;
  margin-left: 2rpx;
  border: 7rpx solid #ffedbd;
  border-radius: 50%;
  background: #bc8540;
}
.pointer-tip {
  width: 0;
  height: 0;
  margin-top: -9rpx;
  border-left: 20rpx solid transparent;
  border-right: 20rpx solid transparent;
  border-top: 48rpx solid #b77e37;
}
.wheel-shadow {
  width: 330rpx;
  height: 22rpx;
  margin-top: 25rpx;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(118, 86, 45, .15), transparent 70%);
}

/* 按钮 */
.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 90rpx;
  padding: 0 20rpx;
  border-radius: 18rpx;
  font-size: 29rpx;
  font-weight: 700;
}
.primary-btn {
  background: linear-gradient(105deg, #665bc2, #8270d8);
  color: #fff;
  box-shadow: 0 9rpx 20rpx rgba(109, 91, 192, .18);
}
.primary-btn::after {
  border: none;
}
.primary-btn[disabled] {
  background: #eeedf5;
  color: #a7a2bb;
  box-shadow: none;
}
.primary-btn.busy-btn[disabled] {
  background: #e9e5fb;
  color: #8a7abd;
}
.stage-note {
  display: block;
  margin-top: 18rpx;
  font-size: 20rpx;
  line-height: 1.7;
  color: #a09aaf;
  text-align: center;
}

/* 抽奖结果 */
.result-card {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
  padding: 22rpx;
  border: 2rpx solid #eceaf5;
  border-radius: 18rpx;
  background: #f7f6fc;
}
.result-win {
  border-color: #f2dfaf;
  background: linear-gradient(120deg, #fff8e6, #fffcf3);
}
.result-icon {
  flex-shrink: 0;
  margin-right: 18rpx;
  font-size: 46rpx;
}
.result-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.result-kicker {
  color: #a29bb4;
  font-size: 19rpx;
}
.result-title {
  margin-top: 7rpx;
  color: #716581;
  font-size: 27rpx;
  font-weight: 700;
  word-break: break-all;
}
.result-win .result-title {
  color: #a5782d;
}
.result-desc {
  margin-top: 9rpx;
  color: #a098ad;
  font-size: 21rpx;
  line-height: 1.7;
}

/* 生效外观 */
.cos-row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f3f3f8;
}
.cos-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}
.cos-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 66rpx;
  height: 66rpx;
  margin-right: 16rpx;
  border-radius: 18rpx;
  background: #f5f2ff;
  color: #9682cb;
  font-size: 30rpx;
}
.cos-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.cos-label {
  font-size: 25rpx;
  font-weight: 600;
}
.cos-expiry {
  margin-top: 8rpx;
  color: #9b9fb0;
  font-size: 20rpx;
  word-break: break-all;
}
.active-tag {
  flex-shrink: 0;
  margin-left: 10rpx;
  padding: 6rpx 12rpx;
  border-radius: 8rpx;
  background: #eaf8f0;
  color: #58a67d;
  font-size: 19rpx;
}

/* 奖励池 */
.pool {
  display: flex;
  flex-wrap: wrap;
  margin: 0 -6rpx;
}
.pool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: calc(33.333% - 12rpx);
  box-sizing: border-box;
  margin: 0 6rpx 12rpx;
  padding: 22rpx 8rpx;
  border: 2rpx solid #efedf7;
  border-radius: 16rpx;
  background: #fcfbff;
}
.pool-icon {
  font-size: 38rpx;
}
.pool-label {
  margin-top: 12rpx;
  color: #706780;
  font-size: 22rpx;
  font-weight: 600;
  text-align: center;
  word-break: break-all;
}
.pool-duration {
  margin-top: 7rpx;
  color: #aaa4b7;
  font-size: 18rpx;
}
.fair-note {
  display: flex;
  align-items: flex-start;
  margin-top: 18rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background: #f7f8fc;
  color: #989daf;
  font-size: 20rpx;
  line-height: 1.8;
}
.fair-icon {
  flex-shrink: 0;
  margin-right: 10rpx;
  color: #aaa6c2;
}
.empty-tip {
  display: block;
  padding: 20rpx 0;
  color: #a0a5b6;
  font-size: 23rpx;
  text-align: center;
}

/* 随机抽人 */
/* 名单来源切换(按分组 / 自选成员) */
.pick-tabs {
  display: flex;
  margin-bottom: 14rpx;
  padding: 6rpx;
  border-radius: 15rpx;
  background: #f3f4fa;
}
.pick-tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 15rpx 0;
  border-radius: 11rpx;
  color: #8c90a5;
  font-size: 24rpx;
}
.pick-tab.on {
  background: linear-gradient(105deg, #665bc2, #8270d8);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4rpx 12rpx rgba(109, 91, 192, .22);
}

/* 自选成员面板 */
.pick-panel {
  margin-bottom: 18rpx;
  padding: 18rpx;
  border: 2rpx solid #eee9fb;
  border-radius: 18rpx;
  background: #faf9ff;
}
.pick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
}
.pick-count {
  color: #6f68a8;
  font-size: 23rpx;
  font-weight: 600;
}
.pick-actions {
  display: flex;
  align-items: center;
}
.pick-action {
  margin-left: 22rpx;
  padding: 4rpx 2rpx;
  color: #7a6fc4;
  font-size: 23rpx;
}
.pick-action.off {
  color: #c3c1d4;
}
.pick-grid {
  display: flex;
  flex-wrap: wrap;
  margin-right: -12rpx;
}
/* 分数分组 */
.pick-tip {
  display: block;
  margin-bottom: 12rpx;
  color: #9a94b8;
  font-size: 21rpx;
  line-height: 1.6;
}
.error-tip {
  color: #c07a7a;
}
.score-group {
  margin-bottom: 14rpx;
}
.score-group:last-child {
  margin-bottom: 0;
}
.score-head {
  display: flex;
  align-items: center;
  margin-bottom: 10rpx;
  padding-bottom: 8rpx;
  border-bottom: 2rpx dashed #ece8fa;
}
.score-value {
  color: #b8860b;
  font-size: 25rpx;
  font-weight: 700;
}
.score-value.zero {
  color: #a5a2b8;
  font-weight: 600;
}
.score-meta {
  flex: 1;
  /* min-width:0 必须写: 否则 flex 子项不肯收缩, 长的名次文案会把整行顶宽,
     进而把整个页面撑出横向滚动条, 右边的「整组选中」会被切掉 */
  min-width: 0;
  margin-left: 12rpx;
  color: #9a94b8;
  font-size: 21rpx;
}
.score-pick {
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 4rpx 14rpx;
  border: 2rpx solid #ded8f3;
  border-radius: 10rpx;
  background: #fff;
  color: #7a6fc4;
  font-size: 21rpx;
}
.score-pick.on {
  border-color: #b9aef0;
  background: #f2eeff;
  color: #5b4fa8;
  font-weight: 600;
}
.pick-item {
  display: flex;
  align-items: center;
  max-width: 100%;
  box-sizing: border-box;
  margin: 0 12rpx 12rpx 0;
  padding: 10rpx 16rpx;
  border: 2rpx solid #eceaf7;
  border-radius: 12rpx;
  background: #fff;
  color: #7b8296;
  font-size: 23rpx;
}
.pick-item.on {
  border-color: #b9aef0;
  background: #f2eeff;
  color: #5b4fa8;
  font-weight: 600;
}
.pick-mark {
  margin-right: 8rpx;
  color: #b3aede;
  font-size: 22rpx;
}
.pick-item.on .pick-mark {
  color: #7a6fc4;
}
.pick-name {
  word-break: break-all;
}

.scope-tabs {
  display: flex;
  padding: 6rpx;
  border-radius: 15rpx;
  background: #f3f4fa;
}
.scope-tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 15rpx 0;
  border-radius: 11rpx;
  color: #8c90a5;
  font-size: 24rpx;
}
.scope-tab.on {
  background: #fff;
  color: #6960b7;
  font-weight: 600;
  box-shadow: 0 3rpx 10rpx rgba(62, 57, 116, .06);
}
.scope-dot {
  width: 10rpx;
  height: 10rpx;
  margin-right: 9rpx;
  border-radius: 50%;
  background: #9690ce;
}
.scope-dot.green {
  background: #60ba92;
}
.scope-dot.red {
  background: #dd8888;
}
.fun-stage {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 360rpx;
  box-sizing: border-box;
  margin: 24rpx 0;
  padding: 34rpx 22rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #454388, #7564bd);
}
.fun-orbit {
  position: absolute;
  width: 340rpx;
  height: 340rpx;
  border: 2rpx solid rgba(255, 255, 255, .09);
  border-radius: 50%;
  pointer-events: none;
}
.orbit-one {
  top: -190rpx;
  left: -140rpx;
}
.orbit-two {
  right: -180rpx;
  bottom: -190rpx;
  width: 440rpx;
  height: 440rpx;
  border-width: 32rpx;
  border-color: rgba(255, 255, 255, .04);
}
.fun-eyebrow {
  position: relative;
  color: #d4cdef;
  font-size: 20rpx;
  letter-spacing: 3rpx;
}
.fun-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100rpx;
  height: 100rpx;
  margin-top: 24rpx;
  border: 2rpx solid rgba(255, 233, 179, .55);
  border-radius: 30rpx;
  background: rgba(255, 255, 255, .12);
  color: #ffe9b4;
  font-size: 48rpx;
  font-weight: 700;
}
.fun-name {
  position: relative;
  max-width: 100%;
  margin-top: 22rpx;
  color: #fff;
  font-size: 38rpx;
  font-weight: 800;
  text-align: center;
  word-break: break-all;
}
.fun-caption {
  position: relative;
  margin-top: 16rpx;
  color: #cec5e9;
  font-size: 20rpx;
  text-align: center;
}
.fun-running .fun-avatar {
  animation: lucky-pulse .6s ease-in-out infinite alternate;
}
@keyframes lucky-pulse {
  from { opacity: .6; transform: scale(.95); }
  to { opacity: 1; transform: scale(1.04); }
}
.fun-result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  margin-top: 22rpx;
  padding: 18rpx;
  border-radius: 14rpx;
  background: #faf5e9;
  color: #b28c4b;
  font-size: 24rpx;
}
.fun-result-name {
  margin-left: 12rpx;
  font-weight: 700;
  word-break: break-all;
}
.count-badge {
  margin-left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: #f0eefb;
  color: #8d80ba;
  font-size: 20rpx;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  margin-right: -12rpx;
}
.chip {
  display: flex;
  align-items: center;
  max-width: 100%;
  box-sizing: border-box;
  margin: 0 12rpx 12rpx 0;
  padding: 11rpx 18rpx;
  border: 2rpx solid #efeff6;
  border-radius: 12rpx;
  background: #f8f9fc;
  color: #82899d;
  font-size: 23rpx;
  word-break: break-all;
}
.chip-selected {
  border-color: #e9ce8f;
  background: #fff6df;
  color: #a37a32;
  font-weight: 600;
}
.chip-star {
  margin-right: 8rpx;
  color: #cf9d37;
}

/* 页脚 */
.footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12rpx 0;
  color: #a8a3b8;
  font-size: 21rpx;
  letter-spacing: 1rpx;
}
.footer-star {
  margin: 0 14rpx;
  color: #c8b990;
  font-size: 19rpx;
}
</style>
