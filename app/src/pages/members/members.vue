<template>
  <view class="page">
    <!-- 概览 -->
    <view class="hero">
      <view class="hero-heading">
        <view>
          <text class="hero-title">部落成员</text>
          <text class="hero-description">
            管理参战状态，关注长期红牌成员
          </text>
        </view>

        <text class="identity">
          {{ canWrite ? '管理员' : '只读' }}
        </text>
      </view>

      <view class="metrics">
        <view class="metric">
          <text class="metric-number">{{ activeCount }}/50</text>
          <text class="metric-label">当前在部落</text>
        </view>
        <view class="metric">
          <text class="metric-number">{{ greenCount }}</text>
          <text class="metric-label">绿牌</text>
        </view>
        <view class="metric">
          <text class="metric-number">{{ redCount }}</text>
          <text class="metric-label">红牌</text>
        </view>
        <view class="metric">
          <text class="metric-number">{{ archivedCount }}</text>
          <text class="metric-label">已归档</text>
        </view>
      </view>
    </view>

    <button
      v-if="archivedCount"
      class="archived-banner"
      @click="filter = 'archived'"
    >
      <text>有 {{ archivedCount }} 名成员已归档（不占在部落名额）</text>
      <text>查看 ›</text>
    </button>

    <!-- 长期红牌提醒 -->
    <button
      v-if="overdueCount"
      class="overdue-banner"
      @click="filter = 'overdue'"
    >
      <text>{{ overdueCount }} 名成员挂红牌超过 15 天</text>
      <text>查看 ›</text>
    </button>

    <!-- 未确认批次 -->
    <view v-if="pending" class="notice warning">
      <text>
        批量操作结果待确认。请重试原批次，不要创建重复操作。
      </text>
      <button
        class="button secondary"
        :disabled="busy"
        @click="sendPending"
      >
        {{ busy ? '处理中…' : '重试 / 确认原批次' }}
      </button>
    </view>

    <!-- 工具栏 -->
    <view class="card toolbar">
      <input
        v-model="keyword"
        class="input"
        placeholder="搜索昵称或游戏标签"
      />

      <view class="filters">
        <button
          v-for="item in filters"
          :key="item.value"
          class="filter"
          :class="{ active: filter === item.value }"
          @click="filter = item.value"
        >
          {{ item.label }}
        </button>
      </view>

      <view class="toolbar-actions">
        <button
          class="text-button"
          :disabled="busy || loading"
          @click="load"
        >
          {{ loading ? '刷新中…' : '刷新列表' }}
        </button>

        <view v-if="canWrite" class="toolbar-right">
          <button
            class="text-button"
            :disabled="locked"
            @click="goAdd"
          >
            ＋ 新增
          </button>

          <button
            class="text-button"
            :disabled="locked"
            @click="goImport"
          >
            ⇪ 批量导入
          </button>

          <button
            class="text-button"
            :disabled="locked"
            @click="toggleBatchMode"
          >
            {{ batchMode ? '结束多选' : '批量管理' }}
          </button>
        </view>

        <!-- 只读访客: 说明按钮为什么不见了, 并给一个直达登录的入口 -->
        <view v-else class="toolbar-right">
          <text class="readonly-hint">只读模式</text>
          <button class="text-button primary-text" @click="goLoginPage">
            管理员登录
          </button>
        </view>
      </view>
    </view>

    <!-- 批量控制 -->
    <view v-if="batchMode && canWrite" class="card batch-card">
      <view class="batch-heading">
        <text class="section-title">
          已选择 {{ selectedIds.length }} 人
        </text>
        <button
          class="text-button"
          :disabled="locked"
          @click="selectedIds = []"
        >
          清空
        </button>
      </view>

      <view class="batch-select">
        <button
          class="small-button"
          :disabled="locked"
          @click="selectFiltered"
        >
          全选当前 {{ filteredMembers.length }} 人
        </button>
        <button
          class="small-button"
          :disabled="locked"
          @click="invertFiltered"
        >
          反选当前
        </button>
      </view>

      <text v-if="hiddenSelected" class="helper">
        有 {{ hiddenSelected }} 名已选成员不在当前筛选中，
        本次操作仍包含他们。
      </text>

      <!-- 归档视图: 告诉用户这些人怎么恢复(卡片上直接点, 或勾选后批量恢复) -->
      <text v-if="filter === 'archived' && !selectedArchivedCount" class="helper">
        这里共 {{ archivedViewCount }} 人（其中已归档 {{ archivedCount }} 人）：
        不占在部落名额，也不参与新录入；点卡片上的「恢复」，
        或勾选后点「恢复为绿牌」，即可重新计入。
      </text>

      <view class="batch-buttons">
        <!-- 恢复: 只对选中的归档成员生效(在归档视图里最常用) -->
        <button
          v-if="selectedArchivedCount"
          class="batch-button restore"
          :disabled="locked"
          @click="restoreSelected"
        >
          恢复为绿牌（{{ selectedArchivedCount }} 人）
        </button>

        <button
          class="batch-button green"
          :disabled="locked || !selectedIds.length"
          @click="setBatchStatus(0)"
        >
          设为绿牌
        </button>

        <button
          class="batch-button red"
          :disabled="locked || !selectedIds.length"
          @click="setBatchStatus(1)"
        >
          设为红牌
        </button>

        <button
          class="batch-button gray"
          :disabled="locked || !selectedIds.length"
          @click="setBatchStatus(2)"
        >
          设为离开
        </button>

        <button
          class="batch-button blue"
          :disabled="locked || !selectedIds.length"
          @click="showBatchNote = !showBatchNote"
        >
          追加备注
        </button>
      </view>

      <view v-if="showBatchNote" class="note-panel">
        <textarea
          v-model="batchNote"
          class="textarea"
          maxlength="200"
          :disabled="locked"
          placeholder="为所选成员追加同一条备注，不覆盖原备注"
        />
        <button
          class="button primary"
          :disabled="locked || !selectedIds.length || !batchNote.trim()"
          @click="appendBatchNote"
        >
          追加到 {{ selectedIds.length }} 人
        </button>
      </view>

      <button
        class="button danger"
        :disabled="locked || !selectedIds.length"
        @click="archiveSelected"
      >
        批量移除 · 保留历史记录
      </button>
    </view>

    <view v-if="error" class="notice warning">
      {{ error }}
    </view>

    <view v-if="loading && !ready" class="card empty">
      正在加载成员…
    </view>

    <!-- 成员列表 -->
    <view
      v-for="member in filteredMembers"
      :key="member.id"
      class="card member-card"
      :class="{
        selected: selectedSet.has(member.id),
        overdue: isOverdue(member),
        left: member.status === 2
      }"
      @click="onMemberClick(member)"
    >
      <view class="member-main">
        <view v-if="batchMode" class="check-circle">
          {{ selectedSet.has(member.id) ? '✓' : '' }}
        </view>

        <view class="avatar">
          {{ member.nickname.slice(0, 1) || '员' }}
        </view>

        <view class="member-content">
          <view class="member-title-row">
            <text class="member-name">{{ member.nickname }}</text>
            <text v-if="member.archived" class="left-tag archived-tag">
              已归档
            </text>
            <text v-else-if="member.status === 2" class="left-tag">
              离开
            </text>
          </view>

          <text class="member-tag">
            {{ memberInfoText(member) }}
          </text>

          <text v-if="member.archived" class="archived-hint">
            归档于 {{ archivedDate(member) }} · 历史积分与奖励记录仍保留
          </text>

          <MemberWarStatus
            :status="member.status"
            :red-days="member.red_days"
            :compact="member.status === 0"
          />
        </view>

        <!-- 归档成员: 卡片上直接给「恢复」, 不用先切批量管理再勾选 -->
        <view v-if="canWrite && !batchMode && member.archived" class="card-actions">
          <button
            class="mini-button"
            :disabled="locked"
            @click.stop="restoreOne(member)"
          >
            恢复
          </button>

          <!-- 永久删除: 只有超级管理员看得到(后端 ?purge=1 也是这个权限) -->
          <button
            v-if="superAdmin"
            class="mini-button danger"
            :disabled="locked"
            @click.stop="purgeOne(member)"
          >
            永久删除
          </button>

          <text class="arrow">›</text>
        </view>

        <text v-else-if="canWrite && !batchMode" class="arrow">›</text>
      </view>

      <view v-if="isOverdue(member)" class="member-warning">
        长期红牌，建议联系成员确认近期参战安排。
      </view>

      <text v-if="canWrite && member.note" class="member-note">
        {{ member.note }}
      </text>
    </view>

    <view
      v-if="ready && !filteredMembers.length"
      class="card empty"
    >
      没有符合条件的成员
    </view>

    <view v-if="lastResult" class="notice success">
      <text>{{ lastResult }}</text>
    </view>

    <text class="footer">
      移除成员不应删除历史积分、结算及红包记录。
    </text>
  </view>
</template>

<script>
import { get, post, del, canWrite as canWriteNow, isSuperAdmin as isSuperAdminNow } from '@/utils/api';
import { navTo } from '@/utils/navigation';
import { setBrowserTitle } from '@/utils/h5';
import MemberWarStatus from '@/components/MemberWarStatus.vue';

// 本页依赖的后端契约:
//   GET  /api/members?include_archived=1
//                                   -> [{ id, nickname, tag, town_hall, prosperity, status,
//                                       red_since, red_days, note, deleted_at }]
//                                      必须带 include_archived=1: 不带时后端**不返回归档成员**,
//                                      归档的人在本页就彻底找不到了(只能靠批量导入页恢复)。
//                                      前端再用 deleted_at 区分"在册 / 已归档"。
//                                      red_days 由服务端按业务日期算(当天=0, 未知=null)
//                                      列表已由服务端按繁荣度降序(没有繁荣度的排最后), 前端不再排序
//   POST /api/members/batch-action  -> { client_token, operation:'update'|'archive', member_ids, changes }
//                                      changes: { status } 或 { append_note }
//                                      响应 { affected, duplicated, batch_id }; 同 token 同内容返回原结果,
//                                      同 token 不同内容 409; 整批成功或整批失败。
// 归档 = 软删除(deleted_at + status=2): 不删除积分/结算/发奖记录。
// **恢复**: 对已归档成员走 operation:'update' 且 status 为 0/1 —— 服务端会一并把 deleted_at 置空
// (见 members.routes.js 的"转回绿牌/红牌 = 取消归档"), 所以"批量设为绿牌/红牌"就是恢复操作。
// 50 人上限: 批量把成员转回绿牌/红牌时, 若在部落人数将超过 50 则整批拒绝(服务端 409)。

export default {
  components: { MemberWarStatus },

  data() {
    return {
      canWrite: false,
      // 物理删除(?purge=1)只有超级管理员能做, 单独记一个标记控制按钮是否出现
      superAdmin: false,
      active: false,
      loading: false,
      ready: false,
      busy: false,
      requestId: 0,

      members: [],
      keyword: '',
      filter: 'active',
      filters: [
        { value: 'active', label: '在部落' },
        { value: 'green', label: '绿牌' },
        { value: 'red', label: '红牌' },
        { value: 'overdue', label: '超过15天' },
        // 原来这里是"离开"(status===2), 但归档的人根本没被加载进来, 点开永远是空的。
        // 改成"归档": 按 deleted_at 过滤, 归档成员终于能在软件里看到。
        { value: 'archived', label: '归档' },
        // "全部"已删除: 库里不存在"离开但未归档"的人, 归档有独立入口后它没有额外价值
      ],

      batchMode: false,
      selectedIds: [],
      showBatchNote: false,
      batchNote: '',

      pending: null,
      lastResult: '',
      error: '',
    };
  },

  computed: {
    locked() {
      return this.busy || this.loading || !!this.pending;
    },

    selectedSet() {
      return new Set(this.selectedIds);
    },

    activeCount() {
      return this.members.filter((m) => !m.archived && m.status !== 2).length;
    },

    greenCount() {
      return this.members.filter((m) => m.status === 0).length;
    },

    redCount() {
      return this.members.filter((m) => m.status === 1).length;
    },

    archivedCount() {
      return this.members.filter((m) => m.archived).length;
    },

    /** 当前选中的成员里已归档的人数(用于"设为绿牌/红牌"其实是恢复的提示) */
    selectedArchivedCount() {
      const set = this.selectedSet;
      return this.members.filter((m) => set.has(m.id) && m.archived).length;
    },

    /** 归档视图下有多少人(含"设为离开但没归档"的) */
    archivedViewCount() {
      return this.members.filter((m) => m.archived || m.status === 2).length;
    },

    /** 选中的成员是不是全都是已归档的(那样"批量移除"就没意义了) */
    selectedAllArchived() {
      return this.selectedIds.length > 0 && this.selectedArchivedCount === this.selectedIds.length;
    },

    overdueCount() {
      return this.members.filter(this.isOverdue).length;
    },

    filteredMembers() {
      const keyword = this.keyword.trim().toLowerCase();
      // 纯数字关键词额外按"大本营等级 / 繁荣度"精确匹配(输入 14 能找到大本营 14 的人)
      const digitsOnly = /^\d+$/.test(keyword);

      return this.members
        .filter((member) => {
          if (this.filter === 'active' && (member.archived || member.status === 2)) return false;
          if (this.filter === 'green' && member.status !== 0) return false;
          if (this.filter === 'red' && member.status !== 1) return false;
          // 「归档」= 所有不在部落的人: 已归档的 + 被"设为离开"但没归档的。
          // 后者在当前数据里是 0 条, 但"批量设为离开"不写 deleted_at, 一旦出现就必须能在这里看到,
          // 否则删掉「全部」之后这些人会变成哪个筛选都找不到。
          if (this.filter === 'archived' && !(member.archived || member.status === 2)) return false;
          if (this.filter === 'overdue' && !this.isOverdue(member)) return false;

          if (!keyword) return true;

          const text = `${member.nickname} ${member.tag || ''}`.toLowerCase();
          if (text.includes(keyword)) return true;

          return (
            digitsOnly &&
            (String(member.town_hall == null ? '' : member.town_hall) === keyword ||
              String(member.prosperity == null ? '' : member.prosperity) === keyword)
          );
        })
        .slice()
        .sort((a, b) => {
          // 离开的排最后
          if (a.status === 2 && b.status !== 2) return 1;
          if (b.status === 2 && a.status !== 2) return -1;

          // 展示栏按繁荣度排行(没有繁荣度的排最后)
          const pa = a.prosperity == null ? -1 : Number(a.prosperity);
          const pb = b.prosperity == null ? -1 : Number(b.prosperity);
          if (pa !== pb) return pb - pa;

          // 繁荣度相同(或都没有)时: 超期红牌优先, 再按昵称
          const warningDifference =
            Number(this.isOverdue(b)) - Number(this.isOverdue(a));
          if (warningDifference) return warningDifference;

          return a.nickname.localeCompare(b.nickname, 'zh-CN');
        });
    },

    hiddenSelected() {
      const visible = new Set(this.filteredMembers.map((m) => m.id));
      return this.selectedIds.filter((id) => !visible.has(id)).length;
    },
  },

  onShow() {
    this.active = true;
    setBrowserTitle();

    this.canWrite = canWriteNow();
    this.superAdmin = isSuperAdminNow();

    if (!this.canWrite) {
      this.batchMode = false;
      this.selectedIds = [];
      this.pending = null;
      this.batchNote = '';

      // 避免访客暂时看到管理员接口此前返回的备注。
      this.members = [];
      this.ready = false;
    }

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
    toast(title) {
      uni.showToast({ title, icon: 'none', duration: 2600 });
    },

    confirm(title, content) {
      return new Promise((resolve) => {
        uni.showModal({
          title,
          content,
          success: (res) => resolve(!!res.confirm),
          fail: () => resolve(false),
        });
      });
    },

    isOverdue(member) {
      return member.status === 1 &&
        member.red_days !== null &&
        Number(member.red_days) > 15;
    },

    /** 归档日期(deleted_at 由服务端以 'YYYY-MM-DD HH:mm:ss' 字符串返回) */
    archivedDate(member) {
      const value = String(member.deleted_at || '');
      return value ? value.slice(0, 10) : '未知日期';
    },

    /** 列表次行: 「大本营 14 · 繁荣 63」(原来这里显示游戏标签) */
    memberInfoText(member) {
      const th =
        member.town_hall == null || member.town_hall === ''
          ? ''
          : `大本营 ${member.town_hall}`;
      const pr =
        member.prosperity == null || member.prosperity === ''
          ? ''
          : `繁荣 ${member.prosperity}`;

      if (th && pr) return `${th} · ${pr}`;
      return th || pr || '未填写大本营/繁荣度';
    },

    normalizeMember(member) {
      const status = Number(member.status);
      const rawDays = member.red_days;

      const days = rawDays === null ||
        rawDays === undefined ||
        rawDays === ''
        ? null
        : Number(rawDays);

      const toInt = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

      return {
        ...member,
        id: String(member.id),
        nickname: String(member.nickname || ''),
        status,
        archived: !!member.deleted_at,
        town_hall: toInt(member.town_hall),
        prosperity: toInt(member.prosperity),
        red_days:
          Number.isInteger(days) && days >= 0 ? days : null,
      };
    },

    async load() {
      if (this.loading) return;

      const requestId = ++this.requestId;
      this.loading = true;
      this.error = '';

      try {
        // 必须显式带 include_archived=1: 否则后端不返回归档成员, 页面上就再也找不到他们了
        const data = await get('/members?include_archived=1');

        if (!Array.isArray(data)) {
          throw new Error('成员接口返回格式异常');
        }

        if (!this.active || requestId !== this.requestId) return;

        // 归档成员保留在列表里(由"归档"筛选 + deleted_at 标记区分), 不再直接丢弃
        this.members = data.map(this.normalizeMember);

        const valid = new Set(this.members.map((m) => m.id));

        this.selectedIds = this.selectedIds.filter((id) => valid.has(id));
        this.ready = true;
      } catch (error) {
        if (requestId === this.requestId && this.active) {
          this.error = error.message || '加载失败';
        }
      } finally {
        if (requestId === this.requestId) this.loading = false;
      }
    },

    goAdd() {
      if (this.locked || !canWriteNow()) return;
      navTo('/pages/member-edit/member-edit');
    },

    // 批量导入入口(设计稿未包含, 本项目保留原成员页的入口)
    goImport() {
      if (this.locked || !canWriteNow()) return;
      navTo('/pages/member-import/member-import');
    },

    toggleBatchMode() {
      if (this.locked || !canWriteNow()) return;

      this.batchMode = !this.batchMode;
      this.selectedIds = [];
      this.showBatchNote = false;
    },

    goLoginPage() {
      navTo('/pages/login/login');
    },

    onMemberClick(member) {
      if (this.locked || !this.canWrite || !canWriteNow()) return;

      if (this.batchMode) {
        this.selectedIds = this.selectedSet.has(member.id)
          ? this.selectedIds.filter((id) => id !== member.id)
          : [...this.selectedIds, member.id];

        return;
      }

      navTo(
        `/pages/member-edit/member-edit?id=${encodeURIComponent(member.id)}`
      );
    },

    selectFiltered() {
      if (this.locked) return;

      this.selectedIds = [...new Set([
        ...this.selectedIds,
        ...this.filteredMembers.map((m) => m.id),
      ])];
    },

    invertFiltered() {
      if (this.locked) return;

      const visible = new Set(this.filteredMembers.map((m) => m.id));
      const keep = this.selectedIds.filter((id) => !visible.has(id));
      const add = this.filteredMembers
        .filter((m) => !this.selectedSet.has(m.id))
        .map((m) => m.id);

      this.selectedIds = [...keep, ...add];
    },

    newToken() {
      return `member_${Date.now().toString(36)}_${Math.random()
        .toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    },

    setBatchStatus(status) {
      const names = ['绿牌', '红牌', '离开'];

      const suffix = status === 1
        ? '已处于红牌的成员不会重新开始计时。'
        : status === 0
          ? '转为绿牌后结束本次红牌计时。'
          : '保留历史积分和结算记录。';

      // 对已归档的成员来说, 设为绿牌/红牌就是"恢复": 服务端会一并清空 deleted_at
      const restoreNote =
        status === 2 || !this.selectedArchivedCount
          ? ''
          : `其中 ${this.selectedArchivedCount} 名已归档成员会被同时恢复(重新计入在部落)。`;

      return this.beginBatch(
        { operation: 'update', changes: { status } },
        `批量设为${names[status]}`,
        `将 ${this.selectedIds.length} 名成员设为${names[status]}。${suffix}${restoreNote}`
      );
    },

    appendBatchNote() {
      if (!this.batchNote.trim()) return;

      return this.beginBatch(
        {
          operation: 'update',
          changes: { append_note: this.batchNote.trim() },
        },
        '批量追加备注',
        `为 ${this.selectedIds.length} 名成员追加备注，不覆盖原备注。`
      );
    },

    archiveSelected() {
      if (this.selectedAllArchived) {
        this.toast('所选成员都已归档，无需重复操作');
        return Promise.resolve();
      }

      return this.beginBatch(
        { operation: 'archive' },
        '批量移除成员',
        `将 ${this.selectedIds.length} 名成员移入归档，移出"在部落"名单，之后可在「归档」筛选里找到并恢复。历史积分、结算和发奖记录必须保留。`
      );
    },

    /**
     * 恢复: 把已归档成员转回绿牌, 服务端会一并清空 deleted_at。
     * 只提交选中的归档成员 —— 同一批里在册的人不该被顺手改了状态。
     */
    restoreSelected() {
      const ids = this.members
        .filter((m) => this.selectedSet.has(m.id) && m.archived)
        .map((m) => m.id);

      if (!ids.length) {
        this.toast('所选成员里没有已归档的');
        return Promise.resolve();
      }

      return this.beginBatch(
        { operation: 'update', changes: { status: 0 } },
        '恢复已归档成员',
        `将 ${ids.length} 名已归档成员恢复为绿牌，重新计入"在部落"。` +
          '历史积分、结算和发奖记录保持不变。',
        ids
      );
    },

    /**
     * 永久删除(物理删除, 不可逆) —— 仅超级管理员。
     *
     * 后端 DELETE /api/members/:id?purge=1 是 `DELETE FROM members`, 而 schema 里
     * score_records / weekly_results / reward_logs / wheel_spins / member_cosmetics
     * 对 members(id) 都是 ON DELETE CASCADE → 会连带清空该成员的**全部历史**。
     *
     * 因此这里做了三道保险:
     *   1. 只有超管能看到按钮(superAdmin);
     *   2. 删之前先查出会毁掉多少条积分流水, 把代价写进确认框;
     *   3. 两次确认, 第二次明说"不可撤销"。
     */
    async purgeOne(member) {
      if (this.locked || !canWriteNow() || !member || !member.archived) return;

      if (!isSuperAdminNow()) {
        this.toast('仅超级管理员可永久删除成员');
        return;
      }

      // 先算出代价: 这条会一起被删掉的积分流水有多少条
      let cost = 'TA 的全部积分流水';
      try {
        const res = await get(
          `/records?member_id=${encodeURIComponent(member.id)}&limit=1`
        );
        const total = res && Number(res.total);
        if (Number.isFinite(total)) cost = `${total} 条积分流水`;
      } catch (e) {
        // 查不到条数不阻断, 但确认框改用模糊说法
      }

      if (!this.active) return;

      const first = await this.confirm(
        '永久删除成员',
        `将永久删除「${member.nickname}」，无法恢复。` +
          `同时会删掉 TA 的全部历史：${cost}，以及结算快照、发奖记录、转盘记录、成员外观。`
      );
      if (!first || !this.active) return;

      const second = await this.confirm(
        '最后一次确认',
        `真的要永久删除「${member.nickname}」吗？此操作不可撤销，也不能靠备份以外的任何方式找回。`
      );
      if (!second || !this.active) return;

      this.busy = true;
      try {
        const info = await del(`/members/${encodeURIComponent(member.id)}?purge=1`);

        if (!this.active) return;

        // 服务端会回报"实际连带删掉了什么", 如实告诉用户
        const removed = (info && info.removed) || null;
        const detail = removed
          ? `积分流水 ${removed.score_records} 条、结算 ${removed.weekly_results} 条、` +
            `发奖 ${removed.reward_logs} 条、转盘 ${removed.wheel_spins} 条、外观 ${removed.member_cosmetics} 条`
          : '';

        this.selectedIds = this.selectedIds.filter((id) => id !== member.id);
        this.toast(`已永久删除「${member.nickname}」`);
        this.lastResult = detail
          ? `已永久删除「${member.nickname}」；连带删除 ${detail}`
          : `已永久删除「${member.nickname}」及其全部历史记录`;
        await this.load();
      } catch (error) {
        this.toast(error.message || '永久删除失败');
      } finally {
        this.busy = false;
      }
    },

    /**
     * 单个恢复: 卡片上的「恢复」按钮(归档视图里最直接的入口)。
     * 等同于"设为绿牌", 服务端会一并清空 deleted_at。
     */
    restoreOne(member) {
      if (this.locked || !canWriteNow() || !member || !member.archived) return Promise.resolve();

      return this.beginBatch(
        { operation: 'update', changes: { status: 0 } },
        '恢复成员',
        `将「${member.nickname}」恢复为绿牌，重新计入"在部落"。` +
          '历史积分、结算和发奖记录保持不变。',
        [member.id]
      );
    },

    async beginBatch(action, title, message, idsOverride) {
      // idsOverride: 只对指定成员操作(如"恢复"只恢复选中的归档成员, 不动同批里在册的人)
      const ids = (idsOverride && idsOverride.length ? idsOverride : this.selectedIds).map(String);

      if (this.locked || !canWriteNow() || !ids.length) return;

      this.busy = true;

      try {
        const confirmed = await this.confirm(title, message);

        if (!confirmed || !this.active || !canWriteNow()) return;

        this.pending = {
          ...action,
          member_ids: ids,
          client_token: this.newToken(),
        };
      } finally {
        this.busy = false;
      }

      if (this.pending) await this.sendPending();
    },

    async sendPending() {
      if (!this.pending || this.busy || !canWriteNow()) return;

      this.busy = true;
      const payload = JSON.parse(JSON.stringify(this.pending));

      try {
        const result = await post('/members/batch-action', payload);

        if (
          !Number.isInteger(Number(result.affected)) ||
          Number(result.affected) < 0
        ) {
          throw new Error('响应格式异常，请重试确认原批次');
        }

        if (!canWriteNow()) return;

        this.pending = null;
        this.selectedIds = [];
        this.batchNote = '';
        this.showBatchNote = false;

        this.lastResult =
          `本批已确认，实际更新 ${Number(result.affected)} 名成员` +
          (result.duplicated ? '（原批次结果）' : '');

        this.toast(this.lastResult);
        await this.load();
      } catch (error) {
        // 不生成新 token，不自动重发追加备注。
        this.toast(error.message || '操作结果未确认，请重试原批次');
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  background: #f4f6fb;
  color: #29364d;
}

.hero {
  padding: 30rpx;
  border-radius: 24rpx;
  background: linear-gradient(130deg, #4660d7, #7686ed);
  color: #fff;
  margin-bottom: 22rpx;
}
.hero-heading, .member-main, .member-title-row,
.toolbar-actions, .toolbar-right, .batch-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.hero-title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
}
.hero-description {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  color: #e1e7ff;
}
.identity {
  flex-shrink: 0;
  padding: 8rpx 14rpx;
  background: rgba(255,255,255,.15);
  border-radius: 999rpx;
  font-size: 22rpx;
}
.metrics {
  display: flex;
  margin-top: 30rpx;
}
.metric {
  flex: 1;
  text-align: center;
}
.metric + .metric {
  border-left: 2rpx solid rgba(255,255,255,.18);
}
.metric-number {
  display: block;
  font-size: 37rpx;
  font-weight: 700;
}
.metric-label {
  display: block;
  margin-top: 8rpx;
  color: #e1e7ff;
  font-size: 22rpx;
}
.card {
  padding: 24rpx;
  margin-bottom: 20rpx;
  background: #fff;
  border: 2rpx solid #edf0f6;
  border-radius: 20rpx;
}
.input {
  height: 46px;
  padding: 0 20rpx;
  background: #f6f8fc;
  border-radius: 12rpx;
  font-size: 27rpx;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 18rpx;
}
.filter, .small-button, .batch-button,
.text-button, .button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 10rpx 18rpx;
  box-sizing: border-box;
  border-radius: 12rpx;
  font-size: 25rpx;
  line-height: 1.5;
}
.filter {
  background: #f2f4f8;
  color: #7a869b;
}
.filter.active {
  background: #edf1ff;
  color: #5065dc;
  font-weight: 700;
}
.text-button {
  padding: 8rpx 6rpx;
  background: transparent;
  color: #5269dc;
}
.toolbar-actions {
  margin-top: 10rpx;
}
.toolbar-right {
  gap: 20rpx;
}
.readonly-hint {
  color: #9ca3af;
  font-size: 23rpx;
}
.primary-text {
  color: #4361ee;
}
/* 恢复按钮: 是"归档"视图里的主操作, 用蓝色突出 */
.batch-button.restore {
  color: #fff;
  background: #4361ee;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}
.mini-button {
  padding: 8rpx 20rpx;
  margin: 0;
  color: #4361ee;
  background: #eef2ff;
  border: 2rpx solid #d5ddf5;
  border-radius: 999rpx;
  font-size: 23rpx;
  line-height: 1.4;
}
.mini-button::after { border: none; }
.mini-button.danger {
  color: #c0392b;
  background: #fff1f2;
  border-color: #f3cfd4;
}
.overdue-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  min-height: 44px;
  padding: 20rpx;
  margin: 0 0 20rpx;
  border-radius: 14rpx;
  background: #fff2dc;
  color: #a56d2f;
  font-size: 24rpx;
  line-height: 1.6;
}
.batch-card {
  border-color: #d6defb;
}
.section-title {
  font-size: 28rpx;
  font-weight: 700;
}
.batch-select, .batch-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}
.small-button {
  background: #f3f5fa;
  color: #65758e;
}
.batch-button {
  width: calc((100% - 12rpx) / 2);
}
.green { background: #e9f7f0; color: #289a74; }
.red { background: #fff0f2; color: #ce6271; }
.gray { background: #edf0f4; color: #7b8799; }
.blue { background: #edf1ff; color: #5268d7; }
.button {
  width: 100%;
  margin-top: 20rpx;
}
.primary { background: #5267df; color: #fff; }
.secondary { background: #fff; color: #5267df; }
.danger { background: #fff1f2; color: #c75e6c; }

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 82rpx;
  height: 82rpx;
  flex-shrink: 0;
  border-radius: 22rpx;
  background: #edf1ff;
  color: #5b6fd3;
  font-size: 32rpx;
  font-weight: 700;
}
.member-content {
  flex: 1;
  min-width: 0;
}
.member-title-row {
  justify-content: flex-start;
}
.member-name {
  font-size: 29rpx;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.member-tag {
  display: block;
  margin: 7rpx 0 12rpx;
  color: #99a3b3;
  font-size: 22rpx;
}
.arrow {
  color: #a4adbd;
  font-size: 38rpx;
}
.left-tag {
  flex-shrink: 0;
  color: #8d97a7;
  background: #eef1f5;
  border-radius: 7rpx;
  padding: 3rpx 9rpx;
  font-size: 20rpx;
}
/* 已归档: 比"离开"更弱化(灰蓝), 但要有边框以便一眼区分 */
.archived-tag {
  color: #5b6b8c;
  background: #eaeefb;
  border: 2rpx solid #d5ddf5;
}
.archived-hint {
  display: block;
  margin-top: 8rpx;
  color: #8a94a6;
  font-size: 21rpx;
}
/* 已归档成员的整卡降对比度样式沿用下面原有的 .member-card.left */
.archived-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: 20rpx;
  padding: 20rpx 24rpx;
  color: #5b6b8c;
  background: #eef2fb;
  border: 2rpx solid #d9e0f3;
  border-radius: 18rpx;
  font-size: 24rpx;
  text-align: left;
}
.member-card.selected {
  background: #f4f6ff;
  border-color: #7e8fe6;
}
.check-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38rpx;
  height: 38rpx;
  flex-shrink: 0;
  border: 2rpx solid #d7deeb;
  border-radius: 50%;
  color: #fff;
  font-size: 25rpx;
}
.selected .check-circle {
  background: #5267df;
  border-color: #5267df;
}
.member-card.overdue {
  border-color: #f0ddbf;
}
.member-card.left {
  background: #fafbfd;
}
.member-warning {
  margin-top: 18rpx;
  padding: 14rpx 16rpx;
  border-radius: 10rpx;
  background: #fff7e9;
  color: #ab783c;
  font-size: 22rpx;
  line-height: 1.7;
}
.member-note {
  display: block;
  margin-top: 18rpx;
  padding-top: 16rpx;
  border-top: 2rpx solid #f0f2f6;
  font-size: 23rpx;
  color: #8c98ab;
  white-space: pre-wrap;
}
.helper, .footer {
  display: block;
  margin-top: 16rpx;
  color: #8c98ab;
  font-size: 22rpx;
  line-height: 1.7;
}
.footer { text-align: center; }
.textarea {
  width: 100%;
  height: 160rpx;
  margin-top: 20rpx;
  padding: 18rpx;
  box-sizing: border-box;
  border: 2rpx solid #e2e8f2;
  border-radius: 12rpx;
  font-size: 26rpx;
}
.notice {
  padding: 22rpx;
  margin-bottom: 20rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  line-height: 1.7;
}
.warning { background: #fff7e7; color: #9f7534; }
.success { background: #eaf8f0; color: #288562; }
.empty { text-align: center; color: #96a0b1; padding: 50rpx 20rpx; }

button::after { border: none; }
button[disabled] { opacity: .5; }
</style>
