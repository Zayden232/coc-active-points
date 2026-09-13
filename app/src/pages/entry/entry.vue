<template>
  <view class="page">
    <!-- 访客 / 未登录 -->
    <view v-if="!canWrite" class="readonly card">
      <text class="readonly-icon">👁</text>
      <text class="readonly-title">只读浏览</text>
      <text class="readonly-desc">
        录入功能仅管理员可用，你可以查看积分流水与排行榜。
      </text>
      <button class="primary-button" @click="goRecords()">
        查看积分流水
      </button>
      <button class="ghost-button" @click="goLogin()">
        管理员登录
      </button>
    </view>

    <block v-else>
      <!-- 初次加载 -->
      <view v-if="optionsLoading && !optionsReady" class="card state-card">
        <text class="state-title">正在加载录入信息…</text>
      </view>

      <view
        v-else-if="optionsError && !optionsReady"
        class="card state-card"
      >
        <text class="state-title">加载失败</text>
        <text class="muted">{{ optionsError }}</text>
        <button class="secondary-button" @click="loadOptions">
          重新加载
        </button>
      </view>

      <block v-else-if="optionsReady">
        <!-- 不确定是否保存成功的请求 -->
        <view v-if="pendingSubmission && !saving" class="pending-card">
          <text class="pending-title">上次提交结果尚未确认</text>
          <text class="pending-desc">
            可能是网络中断。请优先重试原批次，不要直接重复创建新录入。
          </text>

          <view class="action-row">
            <button class="small-button" @click="save">
              重试原批次
            </button>
            <button
              class="small-button light"
              @click="goRecords(pendingSubmission.payload.client_token)"
            >
              核对流水
            </button>
          </view>

          <text class="text-action warning-text" @click="clearPending">
            已核对，解除待确认状态
          </text>
        </view>

        <!-- 核心录入面板：规则、数量、成员摘要、预览与提交集中在一起 -->
        <view id="entry-editor" class="card entry-editor">
<view class="section-heading compact-heading">
  <view>
    <text class="entry-eyebrow">QUICK SCORE ENTRY</text>
    <text class="section-title">积分录入</text>
  </view>

  <view class="entry-period">
    <view class="period-dot"></view>
    <text>{{ weekStart ? weekStart + ' 起' : '当前周' }}</text>
  </view>
</view>

<view class="entry-guide">
  <text class="guide-number">1</text>
  <text>选积分项</text>
  <text class="guide-line"></text>
  <text class="guide-number">2</text>
  <text>填数量</text>
  <text class="guide-line"></text>
  <text class="guide-number">3</text>
  <text>选人提交</text>
</view>

          <view v-if="!rules.length" class="empty">
            暂无可用积分项，请先在设置中配置。
          </view>

          <block v-else>
            <!-- 规则仅展示名称，两行三列，一次点击切换 -->
<view class="entry-label-row">
  <text class="entry-label-title">积分项目</text>
  <text class="entry-label-hint">切换项目会清空数量，保留成员</text>
</view>

            <view class="entry-rule-grid">
              <button
                v-for="r in rules"
                :key="r.id"
                class="entry-rule-button"
                :class="{ active: ruleId === r.id }"
                :disabled="formLocked"
                @click="pickRule(r.id)"
              >
                {{ r.name }}
              </button>
            </view>

            <!-- 只展示当前规则的说明 -->
            <view v-if="currentRule" class="entry-rule-info">
              <text>
                {{ currentRule.score_per_unit }} 分 /
                {{ currentRule.unit || '单位' }}
              </text>
              <text class="entry-info-divider">·</text>
              <text>
                {{
                  currentRule.weekly_cap == null
                    ? '每周不限分'
                    : '每人每周上限 ' + currentRule.weekly_cap + ' 分'
                }}
              </text>
            </view>

            <!-- 识图结果整段导入: 按星数分组, 每组一个数量 -->
            <button
              v-if="!pasteMode"
              class="entry-paste-open"
              :disabled="formLocked || !currentRule"
              @click="openPaste"
            >
              <text class="entry-paste-open-title">📋 粘贴星数名单</text>
              <text class="entry-paste-open-hint">
                把豆包/识图结果整段贴进来，按「15星 / 14星…」自动分组录入
              </text>
            </button>

            <!-- 分组数量模式: 数量由每组星数决定, 不再单独填 -->
            <view v-else class="entry-paste-plan">
              <view class="entry-paste-plan-head">
                <text class="entry-paste-plan-title">分组数量录入</text>
                <text class="entry-paste-plan-edit" @click="openPaste">修改名单</text>
              </view>

              <view class="entry-paste-plan-chips">
                <text
                  v-for="chip in pasteGroupSummary"
                  :key="chip"
                  class="entry-paste-plan-chip"
                >
                  {{ chip }}
                </text>
              </view>

              <text class="entry-paste-plan-meta">
                共 {{ pasteStats.people }} 人
                <text v-if="pasteStats.fuzzy"> · 近似 {{ pasteStats.fuzzy }}</text>
                <text v-if="pasteStats.ignored"> · 已忽略 {{ pasteStats.ignored }}</text>
                <text v-if="pasteStats.zeroPeople">
                  · 0 星跳过 {{ pasteStats.zeroPeople }} 人
                </text>
              </text>

              <text class="entry-paste-plan-exit" @click="exitPaste">
                退出分组模式，改回手动选人
              </text>
            </view>

            <block v-if="!pasteMode">
            <!-- 数量紧邻规则 -->
            <view class="entry-quantity-row">
              <text class="entry-field-label">每人数量</text>

              <view class="entry-quantity-box">
                <input
                  v-model="quantity"
                  class="entry-quantity-input"
                  type="digit"
                  :disabled="formLocked"
                  placeholder="输入数量"
                  :adjust-position="true"
                  :cursor-spacing="24"
                  confirm-type="done"
                  @confirm="finishQuantityInput"
                />
                <text class="entry-quantity-unit">
                  {{ currentRule ? currentRule.unit || '单位' : '单位' }}
                </text>
              </view>
            </view>

            <view class="entry-quick-row">
              <button
                v-for="q in quickValues"
                :key="q"
                class="entry-quick-button"
                :disabled="formLocked"
                @click="addQuick(q)"
              >
                +{{ q }}
              </button>

              <button
                class="entry-quick-button neutral"
                :disabled="formLocked"
                @click="clearQuantity"
              >
                清空
              </button>
            </view>

<text class="quantity-help">
  快捷按钮为累加数量；当前输入会应用到每位已选成员。
</text>

            <text v-if="quantity !== '' && !quantityValid" class="error-text">
              请输入有效的正数。
            </text>

            <!-- 成员只显示摘要，点击后编辑 -->
            <button
              class="entry-member-summary"
              :disabled="formLocked"
              @click="openMemberPanel"
            >
              <view class="entry-member-summary-top">
                <text class="entry-member-count">
                  {{
                    selectedIds.length
                      ? '已选 ' + selectedIds.length + ' 人'
                      : '选择录入成员'
                  }}
                </text>
                <text class="entry-member-edit">
                  {{ selectedIds.length ? '修改成员 ›' : '点击选择 ›' }}
                </text>
              </view>

              <text class="entry-member-names">
                {{ selectedMemberSummary }}
              </text>
            </button>

            <button
              v-if="lastPick.length && !selectedIds.length"
              class="entry-restore-button"
              :disabled="formLocked"
              @click="restoreLast"
            >
              ↺ 使用该积分项上次成功录入的 {{ lastPick.length }} 名成员
            </button>
            </block>

            <!-- 紧凑预览 -->
            <view class="entry-preview">
              <view class="entry-preview-top">
                <view class="entry-preview-main">
                  <text class="entry-preview-label">预计实际新增</text>
                  <text
                    class="entry-preview-value"
                    :class="{ 'is-error': !!previewError }"
                  >
                    {{ previewTotalText }}
                  </text>
                </view>

                <button
                  class="entry-note-toggle"
                  :disabled="formLocked"
                  @click="noteExpanded = !noteExpanded"
                >
                  {{
                    noteExpanded
                      ? '收起备注'
                      : note
                        ? '修改备注'
                        : '添加备注'
                  }}
                </button>
              </view>

              <text v-if="!pasteMode && quantityValid && currentRule" class="entry-preview-sub">
                每人原始 {{ rawPerPerson }} 分 · 最终按每周上限计算
              </text>

              <text v-else-if="pasteMode" class="entry-preview-sub">
                {{ pasteStats.groupCount }} 个星数组，每组数量不同 · 最终按每周上限计算
              </text>

              <text v-if="previewError" class="preview-error" @click="retryPreview">
                {{ previewError }}，点击重试
              </text>

              <view v-if="previewCurrent && cappedCount" class="entry-warning">
                {{ cappedCount }} 人受到周上限影响，数量仍会记录。
              </view>

              <view v-if="previewCurrent && previewAlreadyCount" class="entry-warning">
                {{ previewAlreadyCount }} 人本周已录过这一项，本次分数会叠加（周上限内）。
              </view>

              <view v-if="previewCurrent && previewTotal === 0" class="entry-warning">
                本批预计新增 0 分，保存前会再次确认。
              </view>

              <input
                v-if="noteExpanded"
                v-model="note"
                class="input entry-note-input"
                :disabled="formLocked"
                maxlength="200"
                :adjust-position="true"
                :cursor-spacing="24"
                placeholder="例如：周三部落战、联赛第 2 天"
              />
            </view>

            <!-- 未选成员时，主按钮直接引导选人 -->
            <button
              v-if="!pasteMode && !selectedIds.length && !pendingSubmission"
              class="primary-button entry-save-button"
              :disabled="formLocked"
              @click="openMemberPanel"
            >
              选择成员后录入
            </button>

            <button
              v-else
              class="primary-button entry-save-button"
              :disabled="submitDisabled"
              @click="submitFromEditor"
            >
              {{
                saving
                  ? '提交中…'
                  : pendingSubmission
                    ? '重试原批次'
                    : pasteMode
                      ? '确认分组录入 · ' + pasteStats.people + ' 人'
                      : '确认录入 · ' + selectedIds.length + ' 人'
              }}
            </button>
          </block>
        </view>

<!-- 成员选择弹层 -->
<view v-if="membersPanelOpen" class="member-picker-layer">
  <!-- 阻止遮罩上的手势滚动底层页面 -->
  <view
    class="member-picker-mask"
    @click="closeMemberPanel"
    @touchmove.stop.prevent="noop"
  ></view>

  <view class="member-picker-sheet">
    <view class="picker-handle"></view>

    <!-- 固定头部 -->
    <view class="picker-header">
      <view class="picker-title-group">
        <text class="picker-title">
          {{ assignTarget ? '指定成员' : '选择录入成员' }}
        </text>
        <text class="picker-subtitle">
          {{
            assignTarget
              ? '为「' + assignTarget.name + '」指定成员 · 点击即指定'
              : '共 ' + eligibleMembers.length + ' 人 · 点击卡片可多选'
          }}
        </text>
      </view>

      <button
        class="picker-close"
        aria-label="关闭成员选择"
        @click="closeMemberPanel"
      >
        ×
      </button>
    </view>

    <!-- 固定搜索与筛选 -->
    <view class="picker-controls">
      <view class="picker-search">
        <text class="picker-search-symbol">⌕</text>

        <input
          v-model="keyword"
          class="picker-search-input"
          :disabled="formLocked"
          placeholder="搜索昵称 / 游戏标签"
          confirm-type="search"
          :adjust-position="true"
          @confirm="finishQuantityInput"
        />

        <button
          v-if="keyword"
          class="picker-search-clear"
          :disabled="formLocked"
          @click="keyword = ''"
        >
          清空
        </button>
      </view>

      <view class="picker-filters">
        <button
          v-for="filter in memberFilters"
          :key="filter.v"
          class="picker-filter"
          :class="{ active: memberFilter === filter.v }"
          :disabled="formLocked"
          @click="setMemberFilter(filter.v)"
        >
          <view
            v-if="filter.v !== -2"
            class="picker-status-dot"
            :class="filter.v === 0 ? 'status-green' : 'status-red'"
          ></view>

          <text>{{ filter.label }}</text>
          <text class="picker-filter-count">
            {{ memberFilterCount(filter.v) }}
          </text>
        </button>
      </view>

      <view class="picker-toolbar">
        <text class="picker-range">
          当前 {{ displayMembers.length }} 人
        </text>

        <view v-if="!assignTarget" class="picker-toolbar-actions">
          <button
            class="picker-text-button"
            :disabled="formLocked || !displayMembers.length"
            @click="selectAllFiltered"
          >
            全选当前
          </button>

          <button
            class="picker-text-button"
            :disabled="formLocked || !displayMembers.length"
            @click="invertFiltered"
          >
            反选当前
          </button>

          <button
            class="picker-text-button selected-only-button"
            :class="{ active: onlySelected }"
            :disabled="formLocked"
            @click="toggleSelectedOnly"
          >
            {{ onlySelected ? '返回全部' : '只看已选' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 只有成员列表滚动 -->
    <scroll-view
      class="picker-scroll"
      scroll-y
      :scroll-top="memberScrollTop"
      @scroll="onMemberScroll"
    >
      <view class="picker-list-content">
        <button
          v-if="lastPick.length && !assignTarget"
          class="picker-restore"
          :disabled="formLocked"
          @click="restoreLast"
        >
          <text>↺ 使用该积分项上次成功录入的成员</text>
          <text class="picker-restore-count">{{ lastPick.length }} 人 ›</text>
        </button>

        <view class="picker-member-grid">
          <button
            v-for="member in displayMembers"
            :key="member.id"
            class="picker-member"
            :class="{ selected: isSelected(member) }"
            :disabled="formLocked"
            @click="toggle(member.id)"
          >
            <view class="picker-member-top">
              <view
                class="picker-status-dot"
                :class="member.status === 0 ? 'status-green' : 'status-red'"
              ></view>

              <text class="picker-member-name">
                {{ member.nickname || '未命名成员' }}
              </text>

              <view class="picker-check">
                <text v-if="isSelected(member)">✓</text>
              </view>
            </view>

            <text class="picker-member-tag">
              {{ memberMeta(member) }}
            </text>
          </button>
        </view>

        <view v-if="!displayMembers.length" class="picker-empty">
          <text class="picker-empty-title">
            {{ onlySelected ? '当前范围没有已选成员' : '没有找到成员' }}
          </text>
          <text class="picker-empty-description">
            尝试清空搜索，或切换红绿牌筛选
          </text>
        </view>

        <text v-if="displayMembers.length" class="picker-list-tip">
          {{
            onlySelected
              ? '当前只展示已选成员，点击可取消选择'
              : '已展示当前范围全部成员，无需翻页'
          }}
        </text>
      </view>
    </scroll-view>

    <!-- 固定底部：无论滚到哪里都能完成 -->
    <view class="picker-footer">
      <view v-if="assignTarget" class="picker-hidden-warning">
        正在为「{{ assignTarget.name }}」指定成员，点击上方任一成员即可。
      </view>

      <view v-else-if="hiddenSelectedCount" class="picker-hidden-warning">
        另有 {{ hiddenSelectedCount }} 名已选成员不在当前筛选内，
        提交时仍会包含。
      </view>

      <view v-if="!assignTarget" class="picker-footer-summary">
        <view class="picker-selection-total">
          <text>已选</text>
          <text class="picker-selection-number">{{ selectedIds.length }}</text>
          <text>/ {{ eligibleMembers.length }} 人</text>
        </view>

        <button
          class="picker-clear-all"
          :disabled="formLocked || !selectedIds.length"
          @click="clearSelection"
        >
          清空全部选择
        </button>
      </view>

      <button
        class="picker-confirm"
        @click="closeMemberPanel"
      >
        {{ assignTarget ? '取消指认' : '完成选择 · ' + selectedIds.length + ' 人' }}
      </button>
    </view>
  </view>
</view>

<!-- 粘贴星数名单弹层 (豆包/识图结果 -> 按星数分组) -->
<view v-if="pasteOpen" class="paste-layer">
  <view
    class="member-picker-mask"
    @click="closePaste"
    @touchmove.stop.prevent="noop"
  ></view>

  <view class="member-picker-sheet">
    <view class="picker-handle"></view>

    <view class="picker-header">
      <view class="picker-title-group">
        <text class="picker-title">粘贴星数名单</text>
        <text class="picker-subtitle">
          {{
            currentRule
              ? currentRule.name + ' · ' + currentRule.score_per_unit + ' 分 / ' + (currentRule.unit || '单位')
              : '请先选择积分项'
          }}
        </text>
      </view>

      <button
        class="picker-close"
        aria-label="关闭粘贴面板"
        @click="closePaste"
      >
        ×
      </button>
    </view>

    <scroll-view class="picker-scroll" scroll-y>
      <view class="picker-list-content">
        <textarea
          v-model="pasteText"
          class="paste-textarea"
          :disabled="formLocked"
          :maxlength="4000"
          placeholder="把识图结果整段贴进来，例如：&#10;# 按胜利之星分组整理&#10;15星：帅隆隆、经过、晚归&#10;14星：小羊、王运好&#10;0星：Lazy"
          @input="onPasteInput"
        />

        <view class="paste-toolbar">
          <button
            class="small-button"
            :disabled="formLocked || !pasteText.trim()"
            @click="runPasteParse"
          >
            解析名单
          </button>

          <button
            class="small-button light"
            :disabled="formLocked || !pasteText"
            @click="clearPasteText"
          >
            清空
          </button>
        </view>

        <text v-if="pasteError" class="error-text">{{ pasteError }}</text>

        <block v-if="pasteParsed">
          <view class="paste-stats">
            <text class="paste-stats-main">
              可录入 {{ pasteStats.people }} 人 · {{ pasteStats.groupCount }} 组不同数量
            </text>
            <text class="paste-stats-sub">
              精确 {{ pasteStats.exact }}
              <text v-if="pasteStats.fuzzy"> · 近似 {{ pasteStats.fuzzy }}（请核对）</text>
              <text v-if="pasteStats.tag"> · 标签匹配 {{ pasteStats.tag }}</text>
              <text v-if="pasteStats.manual"> · 已指认 {{ pasteStats.manual }}</text>
              <text v-if="pasteStats.duplicate"> · 重复 {{ pasteStats.duplicate }}</text>
              <text v-if="pasteStats.ignored"> · 已忽略 {{ pasteStats.ignored }}</text>
              <text v-if="pasteStats.zeroPeople"> · 0 星跳过 {{ pasteStats.zeroPeople }}</text>
              <text v-if="pasteStats.unresolved"> · 待处理 {{ pasteStats.unresolved }}</text>
            </text>
          </view>

          <view
            v-for="(group, gi) in pasteGroups"
            :key="gi + '-' + group.star"
            class="paste-group"
          >
            <view class="paste-group-head">
              <text class="paste-star" :class="{ zero: group.zero }">
                {{ group.star }} 星
              </text>
              <text class="paste-group-meta">
                {{ group.rows.length }} 人
                <text v-if="!group.zero">
                  · 每人 {{ group.star }} {{ currentRule ? currentRule.unit || '单位' : '单位' }}
                </text>
                <text v-else> · 不录入</text>
              </text>
            </view>

            <view class="paste-rows">
              <view
                v-for="(row, ri) in group.rows"
                :key="row.name + '-' + ri"
                class="paste-row"
                :class="pasteRowClass(row)"
              >
                <view class="paste-row-main">
                  <text class="paste-row-name">{{ row.name }}</text>
                  <text class="paste-row-state">{{ rowStateText(row) }}</text>

                  <!-- 快速切换: 归一化后相近的成员, 点一下直接换(不用开弹层) -->
                  <view
                    v-if="!row.ignored && row.kind !== 'zero' && row.alts && row.alts.length"
                    class="paste-alts"
                  >
                    <text class="paste-alts-label">快速切换</text>
                    <text
                      v-for="alt in row.alts"
                      :key="alt.id"
                      class="paste-alt"
                      :class="{ active: alt.id === row.memberId }"
                      @click="quickAssign(gi, ri, alt.id)"
                    >
                      {{ alt.nickname }}
                    </text>
                  </view>
                </view>

                <view v-if="row.kind !== 'zero'" class="paste-row-ops">
                  <text
                    v-if="!row.ignored"
                    class="paste-op"
                    @click="openAssign(gi, ri)"
                  >
                    {{ row.memberId ? '换人' : '指认' }}
                  </text>

                  <text
                    v-if="!row.ignored && (row.kind === 'none' || row.kind === 'ambiguous')"
                    class="paste-op"
                    @click="createMember(gi, ri)"
                  >
                    新建
                  </text>

                  <text class="paste-op" @click="toggleIgnore(gi, ri)">
                    {{ row.ignored ? '恢复' : '忽略' }}
                  </text>
                </view>
              </view>
            </view>
          </view>

          <view v-if="pasteIgnoredLines.length" class="paste-ignored-lines">
            <text class="paste-ignored-title">这些行没解析出星数，已跳过：</text>
            <text
              v-for="(line, i) in pasteIgnoredLines"
              :key="i"
              class="paste-ignored-line"
            >
              {{ line }}
            </text>
          </view>
        </block>
      </view>
    </scroll-view>

    <view class="picker-footer">
      <view v-if="pasteBlockerText" class="picker-hidden-warning">
        {{ pasteBlockerText }}
      </view>

      <button
        class="picker-confirm"
        :disabled="!pasteCanApply"
        @click="applyPaste"
      >
        {{
          pasteCanApply
            ? '应用分组 · ' + pasteStats.people + ' 人'
            : '解析并处理名单后应用'
        }}
      </button>
    </view>
  </view>
</view>

        <!-- 保存结果 -->
        <view v-if="lastBatch" class="result-card">
          <text class="result-title">
            {{ lastBatch.hasErrors ? '录入结果需核对' : '本批提交已返回' }}
          </text>

          <text class="result-main">
            新增 {{ lastBatch.inserted }} 条
            <text v-if="lastBatch.duplicated">
              · 重复 {{ lastBatch.duplicated }} 条
            </text>
          </text>

          <text
            v-if="lastBatch.delta !== null"
            class="result-main"
          >
            实际新增 {{ lastBatch.delta }} 分
          </text>

          <text v-else class="result-sub">
            服务端未返回最终新增积分，请在流水中核对。
          </text>

          <text class="result-sub">
            {{ lastBatch.ruleName }} · {{ lastBatch.quantityText }}
            · {{ lastBatch.weekStart }}
          </text>

          <text v-if="lastBatch.errorText" class="error-text">
            {{ lastBatch.errorText }}
          </text>

          <view class="action-row">
            <button
              class="small-button light"
              @click="goRecords(lastBatch.token)"
            >
              查看本批
            </button>

            <button
              class="small-button danger-button"
              :disabled="saving || revoking || !!pendingSubmission"
              @click="revokeBatch"
            >
              {{ revoking ? '撤销中…' : '撤销本批' }}
            </button>
          </view>
        </view>

      </block>

      <!-- 兜底: 请求被取消或状态异常时避免白屏 -->
      <view v-else class="card state-card">
        <text class="state-title">暂时无法加载录入信息</text>
        <text class="muted">请检查网络后重试</text>
        <button class="secondary-button" @click="loadOptions">重新加载</button>
      </view>
    </block>
  </view>
</template>

<script>
import { get, post, canWrite as canWriteNow } from '@/utils/api';
import { buildStarPlan, summarizePlan, planEntries } from '@/utils/star-paste';
import { navTo } from '@/utils/navigation';
import { setBrowserTitle } from '@/utils/h5';

// 本页依赖的后端契约(服务端会二次校验, 不信任前端预览):
//   GET  /api/options                       -> { rules, members, now.week_start }
//   POST /api/records/preview               -> { total_delta, members[{member_id,before,capped}] }
//   POST /api/records                       -> { inserted, duplicated, total_delta, week_start, errors }
//   POST /api/records/batches/:token/revoke -> { revoked }
// 服务端校验: 管理员权限 / 规则启用 / 数量为正 / 成员未离开 / 批次号内容不可复用。
//
// 两种录入形态(共用同一套预览/保存/撤销):
//   1. 正常录入:  {rule_id, quantity, member_ids} —— 一个数量给所有人;
//   2. 粘贴星数:  {entries:[{rule_id, quantity, member_ids}]} —— 每个星数组一个数量,
//      仍然是一个事务、一个批次号, 因此「撤销本批」一次性回滚全部组。

// 当前规则"上次成功录入"的成员记忆
const PICK_KEY = (ruleId) => `coc_last_success_members_${ruleId}`;
// 兼容旧版本页面写入的记忆键(首次读取时兜底)
const LEGACY_PICK_KEY = (ruleId) => `coc_last_members_${ruleId}`;

export default {
  data() {
    return {
      canWrite: false,
      pageActive: false,

      optionsLoading: false,
      optionsReady: false,
      optionsError: '',
      optionsRequestId: 0,

      rules: [],
      members: [],
      ruleId: null,
      weekStart: '',

      selectedIds: [],
      lastPick: [],
      keyword: '',
      memberFilter: -2,
      memberFilters: [
        { v: -2, label: '全部在部落' },
        { v: 0, label: '部落战绿牌' },
        { v: 1, label: '部落战红牌' },
      ],

      onlySelected: false,
      // 选人弹层: 滚动位置(用于切筛选后回到顶部)
      memberScrollTop: 0,
      memberScrollPosition: 0,
      // 选人弹层按需展开; 备注默认收起
      membersPanelOpen: false,
      noteExpanded: false,
      // 选人弹层的另一种用途: 给粘贴名单里的某一行"指认"成员
      assignTarget: null,

      // 粘贴星数名单(豆包/OCR 识图结果 -> 按星数分组录入)
      pasteOpen: false,
      pasteText: '',
      pastePlan: { groups: [], ignoredLines: [] },
      pasteParsed: false,
      pasteError: '',
      pasteMode: false,

      quantity: '',
      note: '',

      previewMembers: [],
      previewTotal: 0,
      previewLoading: false,
      previewError: '',
      previewFingerprint: '',
      previewTimer: null,
      previewRequestId: 0,

      saving: false,
      revoking: false,
      lastBatch: null,

      // 保存结果不明确时保留原请求。
      // 在当前页面实例内重试时复用 client_token。
      pendingSubmission: null,
    };
  },

  computed: {
    currentRule() {
      return this.rules.find((r) => r.id === this.ruleId) || null;
    },

    eligibleMembers() {
      return this.members.filter((m) => m.status === 0 || m.status === 1);
    },

    selectedSet() {
      return new Set(this.selectedIds);
    },

    eligibleSet() {
      return new Set(this.eligibleMembers.map((m) => m.id));
    },

    formLocked() {
      return (
        this.saving ||
        this.revoking ||
        this.optionsLoading ||
        !!this.pendingSubmission
      );
    },

    quantityValid() {
      const q = Number(this.quantity);
      return (
        String(this.quantity).trim() !== '' &&
        Number.isFinite(q) &&
        q > 0
      );
    },

    formValid() {
      if (!this.canWrite || !this.optionsReady || !this.currentRule) {
        return false;
      }

      // 粘贴模式: 合法性由"每个星数组至少一人且都是有效成员"决定
      if (this.pasteMode) {
        return (
          this.pasteEntries.length > 0 &&
          this.pasteEntries.every((e) =>
            e.member_ids.every((id) => this.eligibleSet.has(id))
          )
        );
      }

      return (
        this.quantityValid &&
        this.selectedIds.length > 0 &&
        this.selectedIds.every((id) => this.eligibleSet.has(id))
      );
    },

    submitDisabled() {
      if (!this.canWrite || this.saving || this.revoking || this.optionsLoading) {
        return true;
      }
      return !this.pendingSubmission && !this.formValid;
    },

    rawPerPerson() {
      if (!this.currentRule || !this.quantityValid) return 0;

      const value =
        Number(this.quantity) * Number(this.currentRule.score_per_unit);

      return Number.isFinite(value)
        ? Math.round(value * 100) / 100
        : 0;
    },

    quantityPlaceholder() {
      return this.currentRule
        ? `输入${this.currentRule.unit || '数量'}`
        : '请先选择积分项';
    },

    quickValues() {
      const rule = this.currentRule;

      // 后端明确配置的快捷数量优先(必须与 /records 的 quantity 同单位);
      // 不做任何"按规则名猜大数量"的隐式换算。
      if (rule && Array.isArray(rule.quick_values)) {
        const values = [
          ...new Set(
            rule.quick_values
              .map(Number)
              .filter((value) => Number.isFinite(value) && value > 0)
          ),
        ];

        if (values.length) return values.slice(0, 4);
      }

      return [1, 2, 5];
    },

    filteredMembers() {
      const keyword = this.keyword.trim().toLowerCase();

      return this.eligibleMembers.filter((m) => {
        if (this.memberFilter >= 0 && m.status !== this.memberFilter) {
          return false;
        }

        if (!keyword) return true;

        return (
          String(m.nickname || '').toLowerCase().includes(keyword) ||
          String(m.tag || '').toLowerCase().includes(keyword)
        );
      });
    },

    displayMembers() {
      return this.onlySelected
        ? this.filteredMembers.filter((m) => this.selectedSet.has(m.id))
        : this.filteredMembers;
    },

    hiddenSelectedCount() {
      const visibleIds = new Set(this.filteredMembers.map((m) => m.id));
      return this.selectedIds.filter((id) => !visibleIds.has(id)).length;
    },

    // ---- 粘贴星数名单 ----
    pasteGroups() {
      return this.pastePlan && Array.isArray(this.pastePlan.groups)
        ? this.pastePlan.groups
        : [];
    },

    pasteIgnoredLines() {
      return this.pastePlan && Array.isArray(this.pastePlan.ignoredLines)
        ? this.pastePlan.ignoredLines
        : [];
    },

    pasteStats() {
      return summarizePlan(this.pastePlan || { groups: [] });
    },

    // 提交内容: 每个星数组一个数量; 忽略/未匹配/重复/0 星都不会进来
    pasteEntries() {
      return planEntries(this.pastePlan || { groups: [] }, this.ruleId, this.note.trim());
    },

    // 编辑器上的分组摘要(最多列 4 组, 其余折叠)
    pasteGroupSummary() {
      const chips = this.pasteGroups
        .filter((g) => !g.zero)
        .map((g) => ({
          star: g.star,
          count: g.rows.filter((r) => !r.ignored && r.memberId).length,
        }))
        .filter((g) => g.count > 0);

      const shown = chips.slice(0, 4).map((g) => `${g.star}星 × ${g.count}人`);
      return chips.length > 4 ? [...shown, `等 ${chips.length} 组`] : shown;
    },

    // 面板底部的"还差什么", 为空表示可以应用
    pasteBlockerText() {
      if (!this.pasteParsed) return '先在下面粘贴名单并点「解析名单」';

      const s = this.pasteStats;
      if (s.unresolved) {
        return `还有 ${s.unresolved} 个名字没处理：指认 / 新建 / 忽略之后才能应用`;
      }
      if (!s.people) return '没有可录入的人（0 星不会录入）';
      return '';
    },

    pasteCanApply() {
      return (
        this.pasteParsed &&
        !this.formLocked &&
        this.pasteStats.unresolved === 0 &&
        this.pasteStats.people > 0
      );
    },

    // 录入面板上的成员摘要(最多展示 3 个名字)
    selectedMemberSummary() {
      const selected = this.eligibleMembers.filter((m) => this.selectedSet.has(m.id));

      if (!selected.length) {
        return '选择后会保留成员，方便连续切换积分项录入';
      }

      const names = selected
        .slice(0, 3)
        .map((m) => m.nickname || '未命名成员')
        .join('、');

      return selected.length > 3 ? `${names} 等 ${selected.length} 人` : names;
    },

    previewMap() {
      const result = {};
      for (const item of this.previewMembers) {
        result[item.member_id] = item;
      }
      return result;
    },

    currentFingerprint() {
      return this.formValid
        ? this.makeFingerprint(this.createPayload())
        : '';
    },

    previewCurrent() {
      return (
        !!this.currentFingerprint &&
        this.previewFingerprint === this.currentFingerprint &&
        !this.previewLoading &&
        !this.previewError
      );
    },

    cappedCount() {
      if (!this.previewCurrent) return 0;

      return this.previewMembers.filter(
        (m) => m.capped === true || m.capped === 1 || m.capped === '1'
      ).length;
    },

    // 本周已经录过这一项的人: 再录一次会叠加(周上限内), 提醒一下
    previewAlreadyCount() {
      if (!this.previewCurrent) return 0;

      return this.previewMembers.filter((m) => Number(m.before) > 0).length;
    },

    previewTotalText() {
      if (!this.formValid) return '待完善录入信息';
      if (this.previewLoading) return '计算中…';
      if (this.previewError) return '预览失败';
      if (!this.previewCurrent) return '等待计算';
      return `${this.previewTotal} 分`;
    },
  },

  watch: {
    quantity() {
      this.schedulePreview();
    },

    selectedIds() {
      this.schedulePreview();
    },

    ruleId() {
      this.schedulePreview();
    },

    keyword() {
      this.resetMemberScroll();
    },

    memberFilter() {
      this.resetMemberScroll();
    },

    onlySelected() {
      this.resetMemberScroll();
    },
  },

  onShow() {
    this.pageActive = true;
    setBrowserTitle();

    this.canWrite = canWriteNow();

    if (this.canWrite) {
      this.loadOptions();
    } else {
      this.invalidatePreview();
      this.rules = [];
      this.members = [];
      this.selectedIds = [];
      this.lastPick = [];
      this.lastBatch = null;
      this.pendingSubmission = null;
      // 粘贴名单里同样带着成员信息, 访客/登出状态下不能留
      this.pasteOpen = false;
      this.pasteMode = false;
      this.pasteText = '';
      this.pastePlan = { groups: [], ignoredLines: [] };
      this.pasteParsed = false;
      this.pasteError = '';
      this.assignTarget = null;
      this.optionsReady = false;
    }
  },

  onHide() {
    this.pageActive = false;
    this.optionsRequestId += 1;
    this.optionsLoading = false;
    this.invalidatePreview();
  },

  onUnload() {
    this.pageActive = false;
    this.optionsRequestId += 1;
    this.invalidatePreview();
  },

  methods: {
    toast(title) {
      uni.showToast({
        title,
        icon: 'none',
        duration: 2500,
      });
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

    goRecords(token) {
      const url = token
        ? `/pages/records/records?client_token=${encodeURIComponent(token)}`
        : '/pages/records/records';

      navTo(url);
    },

    /** 未登录/访客: 去登录页(登录后返回本页) */
    goLogin() {
      uni.navigateTo({
        url: '/pages/login/login',
        fail: () => uni.showToast({ title: '登录页打开失败', icon: 'none' }),
      });
    },

    async loadOptions() {
      if (!this.canWrite || !canWriteNow()) return;

      const requestId = ++this.optionsRequestId;
      this.optionsLoading = true;
      this.optionsError = '';

      try {
        const opt = await get('/options');

        if (
          requestId !== this.optionsRequestId ||
          !this.pageActive ||
          !canWriteNow()
        ) {
          return;
        }

        this.rules = (opt.rules || [])
          .map((r) => ({ ...r, id: Number(r.id) }))
          .filter((r) => Number.isSafeInteger(r.id) && r.id > 0);

        this.members = (opt.members || [])
          .map((m) => ({
            ...m,
            id: Number(m.id),
            status: Number(m.status),
          }))
          .filter((m) => Number.isSafeInteger(m.id) && m.id > 0);

        this.weekStart = (opt.now && opt.now.week_start) || '';

        if (!this.rules.some((r) => r.id === this.ruleId)) {
          this.ruleId = this.rules.length ? this.rules[0].id : null;
        }

        this.selectedIds = this.selectedIds.filter(
          (id) => this.eligibleSet.has(id)
        );

        // 成员列表可能变了(别人删了/归档了成员), 失效的指认退回"未匹配"
        this.revalidatePaste();

        // 只读入历史选择，不自动覆盖当前表单。
        this.readLastPick();
        this.optionsReady = true;
        this.schedulePreview();
      } catch (e) {
        if (requestId !== this.optionsRequestId || !this.pageActive) return;

        this.optionsError = e.message || '加载失败，请重试';

        if (this.optionsReady) {
          this.toast(this.optionsError);
        }
      } finally {
        if (requestId === this.optionsRequestId) {
          this.optionsLoading = false;
        }
      }
    },

    pickRule(id) {
      if (this.formLocked || id === this.ruleId) return;

      this.ruleId = id;

      // 不同规则的单位可能不同, 避免把"捐兵 500"带进"星数"之类的规则
      this.quantity = '';

      this.readLastPick();
      // 现有 ruleId / quantity watcher 会重新安排预览
    },

    readLastPick() {
      this.lastPick = [];
      if (!this.ruleId) return;

      try {
        let saved = uni.getStorageSync(PICK_KEY(this.ruleId));
        // 兼容旧页面写入的记忆键
        if (!Array.isArray(saved) || !saved.length) {
          const legacy = uni.getStorageSync(LEGACY_PICK_KEY(this.ruleId));
          if (Array.isArray(legacy) && legacy.length) saved = legacy;
        }
        if (!Array.isArray(saved)) return;

        this.lastPick = [...new Set(saved.map(Number))]
          .filter((id) => this.eligibleSet.has(id));
      } catch (e) {
        this.lastPick = [];
      }
    },

    rememberSuccessfulPick(ruleId, ids) {
      const validIds = [...new Set(ids)]
        .filter((id) => this.eligibleSet.has(id));

      try {
        uni.setStorageSync(PICK_KEY(ruleId), validIds);
      } catch (e) {
        // 本地存储失败不影响已完成的录入。
      }

      if (this.ruleId === ruleId) {
        this.lastPick = validIds;
      }
    },

    async restoreLast() {
      if (this.formLocked || !this.lastPick.length) return;

      if (this.selectedIds.length) {
        const confirmed = await this.confirm(
          '使用上次成员',
          '这会替换当前选择，而不是追加成员。是否继续？'
        );

        if (!confirmed || this.formLocked || !this.pageActive) return;
      }

      this.selectedIds = this.lastPick.filter((id) => this.eligibleSet.has(id));
    },

    setMemberFilter(value) {
      if (this.formLocked) return;
      this.memberFilter = value;
    },

    noop() {},

    onMemberScroll(event) {
      this.memberScrollPosition = (event && event.detail && event.detail.scrollTop) || 0;
    },

    resetMemberScroll() {
      // 先同步实际位置再置 0, 否则原本就是 0 时无法触发"回到顶部"。
      this.memberScrollTop = this.memberScrollPosition;

      this.$nextTick(() => {
        this.memberScrollTop = 0;
      });
    },

    memberFilterCount(status) {
      return this.eligibleMembers.filter(
        (member) => status === -2 || member.status === status
      ).length;
    },

    toggleSelectedOnly() {
      if (this.formLocked) return;
      this.onlySelected = !this.onlySelected;
    },

    // 选人弹层里"已选中"的判定: 指认模式看被指认的那一行
    isSelected(member) {
      if (this.assignTarget) return this.assignTarget.memberId === member.id;
      return this.selectedSet.has(member.id);
    },

    toggle(id) {
      if (this.formLocked || !this.eligibleSet.has(id)) return;

      // 指认模式: 选中即回填到粘贴名单的那一行, 然后关闭弹层
      if (this.assignTarget) {
        const target = this.assignTarget;
        const row = this.pasteRow(target.gi, target.ri);
        const member = this.eligibleMembers.find((m) => m.id === id);

        if (row && member) {
          if (this.pasteConflict(row, id)) {
            this.toast(`「${member.nickname}」已经在别的星数组里，同一个人只记一次`);
            return;
          }
          this.assignRow(row, member);
        }

        this.membersPanelOpen = false;
        this.assignTarget = null;
        this.keyword = '';
        return;
      }

      // 替换数组，确保 Vue3 watcher 能触发。
      this.selectedIds = this.selectedSet.has(id)
        ? this.selectedIds.filter((item) => item !== id)
        : [...this.selectedIds, id];
    },

    selectAllFiltered() {
      if (this.formLocked) return;

      // 与界面"当前"范围一致, 包括"只看已选"模式
      const currentIds = this.displayMembers.map((member) => member.id);

      this.selectedIds = [...new Set([...this.selectedIds, ...currentIds])];
    },

    invertFiltered() {
      if (this.formLocked) return;

      // 先固定列表快照, 避免"只看已选"时列表变化影响反选范围
      const currentMembers = [...this.displayMembers];
      const currentIds = new Set(currentMembers.map((member) => member.id));
      const selected = new Set(this.selectedIds);

      const keep = this.selectedIds.filter((id) => !currentIds.has(id));
      const add = currentMembers
        .filter((member) => !selected.has(member.id))
        .map((member) => member.id);

      this.selectedIds = [...keep, ...add];
    },

    async clearSelection() {
      if (this.formLocked || !this.selectedIds.length) return;

      const confirmed = await this.confirm(
        '清空全部选择',
        `将取消全部 ${this.selectedIds.length} 名成员，包括被搜索或筛选隐藏的成员。是否继续？`
      );

      if (!confirmed || this.formLocked || !this.pageActive) return;

      this.selectedIds = [];
    },

    addQuick(value) {
      if (this.formLocked) return;

      const current = Number(this.quantity);
      const base = Number.isFinite(current) && current > 0 ? current : 0;

      this.quantity = String(
        Math.round((base + value) * 1000000) / 1000000
      );
    },

    clearQuantity() {
      if (this.formLocked) return;
      this.quantity = '';
    },

    createPayload() {
      const note = this.note.trim();

      // 粘贴模式: 每个星数组一条 entry(数量 = 星数)
      if (this.pasteMode) {
        return { rule_id: this.ruleId, entries: this.pasteEntries };
      }

      return {
        rule_id: this.ruleId,
        member_ids: [...this.selectedIds].sort((a, b) => a - b),
        quantity: Number(this.quantity),
        note,
      };
    },

    /** 本次要写多少条记录(entries 模式 = 各组人数之和) */
    memberCountOf(payload) {
      return payload.entries
        ? payload.entries.reduce((n, e) => n + e.member_ids.length, 0)
        : payload.member_ids.length;
    },

    /** 真正发给服务端的请求体: entries 形态与单人数量形态都支持 */
    submitBody(payload) {
      if (payload.entries) {
        return {
          ...(payload.client_token ? { client_token: payload.client_token } : {}),
          entries: payload.entries.map((e) => ({
            rule_id: e.rule_id,
            quantity: e.quantity,
            member_ids: [...e.member_ids],
            note: e.note || '',
          })),
        };
      }

      return { ...payload, member_ids: [...payload.member_ids] };
    },

    makeFingerprint(payload) {
      // 备注不影响积分预览。
      if (payload.entries) {
        return JSON.stringify(
          payload.entries
            .map((e) => ({
              rule_id: e.rule_id,
              quantity: e.quantity,
              member_ids: [...e.member_ids].sort((a, b) => a - b),
            }))
            .sort(
              (a, b) =>
                a.quantity - b.quantity ||
                a.member_ids.join(',').localeCompare(b.member_ids.join(','))
            )
        );
      }

      return JSON.stringify({
        rule_id: payload.rule_id,
        member_ids: [...payload.member_ids].sort((a, b) => a - b),
        quantity: payload.quantity,
      });
    },

    invalidatePreview() {
      if (this.previewTimer) {
        clearTimeout(this.previewTimer);
        this.previewTimer = null;
      }

      this.previewRequestId += 1;
      this.previewLoading = false;
      this.previewError = '';
      this.previewFingerprint = '';
      this.previewMembers = [];
      this.previewTotal = 0;
    },

    schedulePreview() {
      this.invalidatePreview();

      if (
        !this.pageActive ||
        !this.canWrite ||
        !this.formValid ||
        this.membersPanelOpen ||
        this.pasteOpen ||
        this.saving ||
        this.pendingSubmission
      ) {
        return;
      }

      this.previewLoading = true;

      this.previewTimer = setTimeout(() => {
        this.previewTimer = null;
        this.runPreview();
      }, 260);
    },

    async requestPreview(payload) {
      const res = await post('/records/preview', this.submitBody(payload));

      if (
        !res ||
        res.total_delta == null ||
        !Number.isFinite(Number(res.total_delta)) ||
        !Array.isArray(res.members)
      ) {
        throw new Error('预览返回格式异常');
      }

      return {
        ...res,
        total_delta: Number(res.total_delta),
      };
    },

    async runPreview() {
      if (
        !this.pageActive ||
        !this.canWrite ||
        !canWriteNow() ||
        !this.formValid ||
        this.pendingSubmission
      ) {
        return;
      }

      const payload = this.createPayload();
      const fingerprint = this.makeFingerprint(payload);
      const requestId = ++this.previewRequestId;

      this.previewLoading = true;
      this.previewError = '';

      try {
        const res = await this.requestPreview(payload);

        if (
          requestId !== this.previewRequestId ||
          !this.pageActive ||
          !canWriteNow() ||
          fingerprint !== this.currentFingerprint
        ) {
          return;
        }

        this.previewMembers = res.members;
        this.previewTotal = res.total_delta;
        this.previewFingerprint = fingerprint;
      } catch (e) {
        if (
          requestId !== this.previewRequestId ||
          !this.pageActive
        ) {
          return;
        }

        this.previewMembers = [];
        this.previewFingerprint = '';
        this.previewError = e.message || '暂时无法计算积分';
      } finally {
        if (requestId === this.previewRequestId) {
          this.previewLoading = false;
        }
      }
    },

    retryPreview() {
      if (this.formLocked) return;
      this.schedulePreview();
    },

    // 键盘"完成"只收起键盘, 不直接保存, 避免误提交
    finishQuantityInput() {
      uni.hideKeyboard();
    },

    // 滚动到指定区块(基于当前页面滚动结构; 若以后改成 scroll-view 需换实现)
    scrollToEntrySection(selector) {
      this.$nextTick(() => {
        if (!this.pageActive) return;

        const query = uni.createSelectorQuery().in(this);
        query.select(selector).boundingClientRect();
        query.selectViewport().scrollOffset();

        query.exec((result) => {
          const rect = result && result[0];
          const viewport = result && result[1];

          if (!rect || !viewport || !this.pageActive) return;

          uni.pageScrollTo({
            scrollTop: Math.max(0, rect.top + viewport.scrollTop - 12),
            duration: 220,
          });
        });
      });
    },

    // ---- 粘贴星数名单(识图结果) ----
    /** 选人卡片次行: 「大本营 14 · 繁荣 63」(原来这里显示游戏标签) */
    memberMeta(member) {
      if (!member) return '';
      const th = member.town_hall == null || member.town_hall === '' ? '' : `大本营 ${member.town_hall}`;
      const pr = member.prosperity == null || member.prosperity === '' ? '' : `繁荣 ${member.prosperity}`;
      if (th && pr) return `${th} · ${pr}`;
      return th || pr || '未填写大本营/繁荣度';
    },

    openPaste() {
      if (this.formLocked || !this.currentRule) return;

      uni.hideKeyboard();

      // 已经解析过的结果保留, 方便"修改名单"; 但打开期间不做预览
      this.pasteOpen = true;
      this.pasteError = '';
      this.invalidatePreview();
    },

    closePaste() {
      uni.hideKeyboard();
      this.pasteOpen = false;

      if (this.pasteMode) this.schedulePreview();
    },

    onPasteInput() {
      // 文本一改, 旧解析结果就作废(否则容易拿上一次的结果提交)
      this.pasteTextChanged();
    },

    pasteTextChanged() {
      this.pasteParsed = false;
      this.pasteError = '';
      this.pastePlan = { groups: [], ignoredLines: [] };
    },

    clearPasteText() {
      if (this.formLocked) return;

      this.pasteText = '';
      this.pasteTextChanged();
    },

    runPasteParse() {
      if (this.formLocked) return;

      const text = String(this.pasteText || '').trim();
      if (!text) {
        this.pasteError = '先粘贴识图结果';
        return;
      }

      // 只匹配"在部落"的成员(已离开/已归档不会出现在选择列表里)
      const plan = buildStarPlan(text, this.eligibleMembers);

      if (!plan.groups.length) {
        this.pastePlan = { groups: [], ignoredLines: plan.ignoredLines };
        this.pasteParsed = false;
        this.pasteError = '没解析出「N星：名字、名字」这样的行，检查一下粘贴内容';
        return;
      }

      this.pastePlan = plan;
      this.pasteParsed = true;
      this.pasteError = '';
    },

    pasteRow(gi, ri) {
      const group = this.pasteGroups[gi];
      return group ? group.rows[ri] : null;
    },

    rowStateText(row) {
      if (row.kind === 'zero') return '0 星，不录入';
      if (row.ignored) return '已忽略';
      if (row.kind === 'duplicate') return `重复，已按「${row.memberName}」记一次`;

      if (row.memberId) {
        if (row.kind === 'fuzzy') return `${row.memberName}（近似，请核对）`;
        if (row.kind === 'manual') return `${row.memberName}（已指认）`;
        if (row.kind === 'tag') return `${row.memberName}（按游戏标签匹配）`;
        return row.memberName;
      }

      if (row.kind === 'ambiguous') {
        return '多个候选，点下面的快速切换选一个';
      }
      return '名单里没有这个人';
    },

    pasteRowClass(row) {
      if (row.kind === 'zero') return 'is-zero';
      if (row.ignored) return 'is-ignored';
      if (row.kind === 'duplicate') return 'is-duplicate';
      if (row.memberId) return row.kind === 'fuzzy' ? 'is-ok is-near' : 'is-ok';
      return 'is-bad';
    },

    /** 这一行要占用的成员(id)是否已经被别的行用了 */
    pasteConflict(row, memberId) {
      return this.pasteGroups.some((g) =>
        g.rows.some((o) => o !== row && !o.ignored && o.memberId === memberId)
      );
    },

    assignRow(row, member) {
      row.memberId = Number(member.id);
      row.memberName = member.nickname || '';
      row.kind = 'manual';
      row.ignored = false;
      row.candidates = [];
    },

    /**
     * 快速切换: 直接切到"相近成员"里的某一个(不开弹层)
     * 和指认一样, 同一个人只能记一次 —— 已被别的行占用就拒绝并提示。
     */
    quickAssign(gi, ri, memberId) {
      if (this.formLocked) return;

      const row = this.pasteRow(gi, ri);
      if (!row || row.kind === 'zero') return;
      if (row.memberId === memberId) return;

      const member = this.eligibleMembers.find((m) => m.id === memberId);
      if (!member) return;

      if (this.pasteConflict(row, memberId)) {
        this.toast(`「${member.nickname}」已经在别的星数组里，同一个人只记一次`);
        return;
      }

      this.assignRow(row, member);
      this.toast(`已切换为「${member.nickname}」`);
    },

    toggleIgnore(gi, ri) {
      if (this.formLocked) return;

      const row = this.pasteRow(gi, ri);
      if (!row || row.kind === 'zero') return;

      // 恢复时同样不允许和别的行撞同一个人
      if (row.ignored && row.memberId && this.pasteConflict(row, row.memberId)) {
        this.toast(`「${row.memberName}」已经在别的星数组里，同一个人只记一次`);
        return;
      }

      row.ignored = !row.ignored;
    },

    openAssign(gi, ri) {
      if (this.formLocked) return;

      const row = this.pasteRow(gi, ri);
      if (!row || row.kind === 'zero') return;

      uni.hideKeyboard();

      this.assignTarget = { gi, ri, name: row.name, memberId: row.memberId };
      // 预填搜索词: 识图名字和真实昵称只差一个字时, 候选会直接出现在列表里
      this.keyword = row.name;
      this.memberFilter = -2;
      this.onlySelected = false;
      this.membersPanelOpen = true;

      this.invalidatePreview();
      this.resetMemberScroll();
    },

    async createMember(gi, ri) {
      if (this.formLocked || !canWriteNow()) return;

      const row = this.pasteRow(gi, ri);
      const nickname = row ? String(row.name || '').trim() : '';
      if (!nickname) return;

      const confirmed = await this.confirm(
        '新建成员',
        `名单里没有「${nickname}」。将新建这个昵称的成员（绿牌）并指认到这一行，是否继续？`
      );

      if (!confirmed || !this.pageActive || !canWriteNow()) return;

      try {
        const created = await post('/members', { nickname, status: 0 });
        const id = Number(created && created.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
          throw new Error('新建成员返回异常');
        }

        if (this.pasteConflict(row, id)) {
          this.toast('该成员已经在别的星数组里，同一个人只记一次');
          return;
        }

        // 让选择列表/合法性判断立刻认识这个新成员, 不用整页重新加载
        this.members = [
          ...this.members,
          {
            id,
            nickname: (created && created.nickname) || nickname,
            tag: (created && created.tag) || '',
            status: Number(created && created.status) || 0,
          },
        ];

        this.assignRow(row, {
          id,
          nickname: (created && created.nickname) || nickname,
        });
        this.toast(`已新建成员「${row.memberName}」`);
      } catch (e) {
        this.toast(e.message || '新建成员失败');
      }
    },

    applyPaste() {
      if (!this.pasteCanApply || !canWriteNow()) return;

      this.pasteMode = true;
      this.pasteOpen = false;
      // 分组模式下数量由每组星数决定, 清掉单人数量避免误解
      this.quantity = '';
      this.schedulePreview();
    },

    exitPaste() {
      this.pasteMode = false;
      this.pasteText = '';
      this.pasteTextChanged();
      this.schedulePreview();
    },

    /** 成员列表刷新后, 把已经失效的指认退回"未匹配" */
    revalidatePaste() {
      for (const g of this.pasteGroups) {
        for (const row of g.rows) {
          if (row.memberId && !this.eligibleSet.has(row.memberId)) {
            row.memberId = null;
            row.memberName = '';
            row.kind = 'none';
          }
        }
      }
    },

    openMemberPanel() {
      if (this.formLocked) return;

      uni.hideKeyboard();

      // 打开后不要被上次遗留的关键词或筛选困住
      this.assignTarget = null;
      this.keyword = '';
      this.memberFilter = -2;
      this.onlySelected = false;
      this.membersPanelOpen = true;

      // 连续选人时不反复请求预览, 关闭弹层后统一计算
      this.invalidatePreview();
      this.resetMemberScroll();
    },

    closeMemberPanel() {
      uni.hideKeyboard();
      this.membersPanelOpen = false;
      this.assignTarget = null;
      this.schedulePreview();
    },

    submitFromEditor() {
      uni.hideKeyboard();
      this.save();
    },

    newToken() {
      // 此 token 用于请求去重，不承担身份认证功能。
      return [
        'b',
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 12),
        Math.random().toString(36).slice(2, 8),
      ].join('');
    },

    async save() {
      if (
        !this.canWrite ||
        !canWriteNow() ||
        this.saving ||
        this.revoking ||
        this.optionsLoading
      ) {
        return;
      }

      if (!this.pendingSubmission && !this.formValid) return;

      this.saving = true;
      this.invalidatePreview();

      try {
        if (!this.pendingSubmission) {
          // 固定请求快照；后续预览和提交使用同一份内容。
          const payload = this.createPayload();
          const ruleName = this.currentRule ? this.currentRule.name : '';

          let preview;
          try {
            preview = await this.requestPreview(payload);
          } catch (e) {
            throw new Error(
              `预览失败，本次未提交：${e.message || '请稍后重试'}`
            );
          }

          if (!this.pageActive || !canWriteNow()) return;

          if (preview.total_delta === 0) {
            const confirmed = await this.confirm(
              '本批预计新增 0 分',
              '成员可能已达到该项每周上限。继续后仍会记录数量，是否保存？'
            );

            if (!confirmed) return;
          }

          if (!this.pageActive || !canWriteNow()) return;

          this.pendingSubmission = {
            payload: {
              ...payload,
              ...(payload.entries
                ? {
                    entries: payload.entries.map((e) => ({
                      ...e,
                      member_ids: [...e.member_ids],
                    })),
                  }
                : { member_ids: [...payload.member_ids] }),
              client_token: this.newToken(),
            },
            ruleName,
            memberCount: this.memberCountOf(payload),
          };
        }

        // 重试直接使用原快照和原 token，不生成新批次。
        const pending = this.pendingSubmission;

        const res = await post('/records', this.submitBody(pending.payload));

        if (
          !res ||
          res.inserted == null ||
          !Number.isFinite(Number(res.inserted))
        ) {
          throw new Error('保存响应异常，请核对流水后重试原批次');
        }

        const inserted = Number(res.inserted);
        const duplicated = Number(res.duplicated) || 0;
        const errors = Array.isArray(res.errors) ? res.errors : [];

        const delta =
          res.total_delta != null &&
          Number.isFinite(Number(res.total_delta))
            ? Number(res.total_delta)
            : null;

        // 身份已失效时不重新展示管理员数据。
        if (!this.canWrite || !canWriteNow()) {
          this.pendingSubmission = null;
          return;
        }

        this.lastBatch = {
          token: pending.payload.client_token,
          inserted,
          duplicated,
          delta,
          weekStart: res.week_start || this.weekStart,
          ruleName: pending.ruleName,
          quantity: pending.payload.quantity,
          quantityText: pending.payload.entries
            ? `共 ${pending.memberCount} 人 · ${pending.payload.entries.length} 组不同数量`
            : `每人 ${pending.payload.quantity}`,
          hasErrors: errors.length > 0,
          errorText: errors.length
            ? typeof errors[0] === 'string'
              ? errors[0]
              : '部分记录存在异常，请查看本批流水核对。'
            : '',
        };

        const completed =
          errors.length === 0 &&
          inserted + duplicated >= pending.memberCount;

        if (completed) {
          const ids = pending.payload.entries
            ? pending.payload.entries.flatMap((e) => e.member_ids)
            : pending.payload.member_ids;

          this.rememberSuccessfulPick(pending.payload.rule_id, ids);

          this.quantity = '';
          this.note = '';

          // 分组录入已提交: 退出分组模式, 避免同一份名单被再点一次
          if (pending.payload.entries) {
            this.pasteMode = false;
            this.pasteText = '';
            this.pasteTextChanged();
          }
        }

        this.pendingSubmission = null;
        this.invalidatePreview();

        this.toast(
          completed
            ? duplicated
              ? '批次已确认，包含已处理记录'
              : '录入成功'
            : '本批处理结果需核对，请查看流水'
        );
      } catch (e) {
        this.toast(e.message || '提交失败，请稍后重试');
      } finally {
        this.saving = false;

        if (!this.pendingSubmission && this.pageActive) {
          this.schedulePreview();
        }
      }
    },

    async clearPending() {
      if (!this.pendingSubmission || this.saving) return;

      const confirmed = await this.confirm(
        '请先核对流水',
        '解除后再次保存会创建新批次。如果原批次已经入账，请勿重复录入。确认已核对并解除？'
      );

      if (!confirmed) return;

      this.pendingSubmission = null;

      // 清空数量，降低直接再次提交相同内容的风险。
      this.quantity = '';
      this.note = '';

      if (this.pasteMode) {
        // 分组模式同理: 退回普通录入, 不给"再点一次"的机会
        this.pasteMode = false;
        this.pasteText = '';
        this.pasteTextChanged();
      }

      this.invalidatePreview();
    },

    async revokeBatch() {
      if (
        !this.canWrite ||
        !canWriteNow() ||
        !this.lastBatch ||
        this.saving ||
        this.revoking ||
        this.pendingSubmission
      ) {
        return;
      }

      const batch = this.lastBatch;
      this.revoking = true;

      try {
        const confirmed = await this.confirm(
          '撤销本批录入',
          '将撤销本批记录并重新计算相关积分。已结算记录是否可撤销由服务端校验。确定继续？'
        );

        if (!confirmed || !canWriteNow()) return;

        const res = await post(
          `/records/batches/${encodeURIComponent(batch.token)}/revoke`,
          {}
        );

        if (this.lastBatch && this.lastBatch.token === batch.token) {
          this.lastBatch = null;
        }

        this.toast(`已撤销 ${Number(res.revoked) || 0} 条记录`);
        this.schedulePreview();
      } catch (e) {
        this.toast(e.message || '撤销失败，请核对流水');
      } finally {
        this.revoking = false;
      }
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx;
  box-sizing: border-box;
  background: #f4f6fb;
  color: #1f2937;
}

.card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  background: #fff;
  border-radius: 22rpx;
  box-shadow: 0 6rpx 24rpx rgba(31, 41, 55, 0.035);
}

.period-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
  margin: 8rpx 0 28rpx;
}

.period-title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
}

.period-desc {
  display: block;
  margin-top: 10rpx;
  color: #6b7280;
  font-size: 23rpx;
  line-height: 1.6;
}

.period-tag {
  flex-shrink: 0;
  padding: 10rpx 14rpx;
  border-radius: 10rpx;
  background: #e9edff;
  color: #4361ee;
  font-size: 21rpx;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
}

.muted {
  color: #6b7280;
  font-size: 24rpx;
}

.selected-count {
  color: #4361ee;
  font-size: 25rpx;
  font-weight: 600;
}

/* 规则 */
.rule-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.rule-item {
  width: calc((100% - 16rpx) / 2);
  box-sizing: border-box;
  padding: 22rpx;
  border: 2rpx solid #edf0f5;
  border-radius: 16rpx;
  background: #f9fafc;
}

.rule-item.active {
  border-color: #4361ee;
  background: #eef2ff;
}

.rule-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8rpx;
}

.rule-name {
  font-size: 27rpx;
  font-weight: 600;
  line-height: 1.4;
}

.rule-check {
  color: #4361ee;
  font-weight: 700;
}

.rule-meta,
.rule-cap {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #6b7280;
  line-height: 1.4;
}

/* 输入 */
.input {
  width: 100%;
  height: 88rpx;
  box-sizing: border-box;
  padding: 0 22rpx;
  border: 2rpx solid #e5e7eb;
  border-radius: 14rpx;
  background: #f9fafb;
  font-size: 28rpx;
}

.search-input {
  margin-bottom: 20rpx;
}

/* 成员 */
.filter-row,
.quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.filter-chip {
  padding: 14rpx 20rpx;
  border: 2rpx solid transparent;
  border-radius: 12rpx;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 23rpx;
}

.filter-chip.active {
  border-color: #c7d2fe;
  background: #eef2ff;
  color: #4361ee;
}

.member-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 28rpx;
  padding: 22rpx 0;
}

.text-action {
  display: inline-block;
  color: #4361ee;
  font-size: 24rpx;
  padding: 8rpx 0;
}

.restore-bar {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 18rpx;
  padding: 18rpx;
  border-radius: 12rpx;
  background: #fff8e8;
  color: #9a6700;
  font-size: 23rpx;
}

.selection-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
}

.legend-dot,
.status-dot {
  display: inline-block;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-dot {
  margin-right: 8rpx;
}

.legend-dot.red {
  margin-left: 18rpx;
}

.green {
  background: #16a34a;
}

.red {
  background: #ef4444;
}

.member-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.member-item {
  width: calc((100% - 14rpx) / 2);
  box-sizing: border-box;
  padding: 20rpx 16rpx;
  border: 2rpx solid #e8ebf2;
  border-radius: 14rpx;
  background: #fafbfe;
}

.member-item.selected {
  background: #edf1ff;
  border-color: #4361ee;
}

.member-main {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.member-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 25rpx;
}

.member-check {
  color: #9ca3af;
  font-size: 28rpx;
}

.member-item.selected .member-check {
  color: #4361ee;
  font-weight: 700;
}

.member-score {
  display: block;
  margin-top: 10rpx;
  color: #64748b;
  font-size: 21rpx;
}

.expand-button {
  margin-top: 20rpx;
  padding: 20rpx;
  text-align: center;
  background: #f6f7fb;
  border-radius: 12rpx;
  color: #4361ee;
  font-size: 25rpx;
}

/* 数量与预览 */
.quantity-box {
  display: flex;
  align-items: center;
  padding: 8rpx 24rpx;
  border: 2rpx solid #dce3f5;
  border-radius: 16rpx;
  background: #fafbff;
}

.quantity-input {
  flex: 1;
  min-width: 0;
  height: 104rpx;
  font-size: 42rpx;
  font-weight: 700;
}

.quantity-unit {
  margin-left: 16rpx;
  color: #6b7280;
  font-size: 26rpx;
}

.quick-row {
  margin-top: 20rpx;
}

.quick-button {
  flex: 1;
  min-width: 70rpx;
  padding: 20rpx 10rpx;
  border-radius: 12rpx;
  text-align: center;
  color: #4361ee;
  background: #edf1ff;
  font-size: 27rpx;
  font-weight: 600;
}

.quick-button.neutral {
  color: #6b7280;
  background: #f3f4f6;
}

.preview-box {
  margin-top: 26rpx;
  padding: 24rpx;
  background: #f7f9ff;
  border-radius: 16rpx;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  gap: 20rpx;
  padding: 10rpx 0;
  color: #64748b;
  font-size: 25rpx;
}

.preview-total {
  margin-top: 10rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #e7ecf8;
  color: #4361ee;
  font-size: 29rpx;
  font-weight: 700;
}

.warning-box {
  margin-top: 18rpx;
  padding: 16rpx;
  border-radius: 10rpx;
  background: #fff7e6;
  color: #9a6700;
  font-size: 23rpx;
  line-height: 1.6;
}

.helper-text {
  display: block;
  margin-top: 18rpx;
  color: #6b7280;
  font-size: 22rpx;
  line-height: 1.6;
}

.error-text,
.preview-error {
  display: block;
  margin-top: 16rpx;
  color: #dc2626;
  font-size: 24rpx;
  line-height: 1.6;
}

/* 提交结果及待确认 */
.pending-card {
  padding: 26rpx;
  margin-bottom: 24rpx;
  background: #fff8e8;
  border: 2rpx solid #f6d99b;
  border-radius: 18rpx;
}

.pending-title {
  display: block;
  color: #92400e;
  font-size: 28rpx;
  font-weight: 700;
}

.pending-desc {
  display: block;
  margin-top: 12rpx;
  color: #9a6700;
  font-size: 24rpx;
  line-height: 1.6;
}

.warning-text {
  color: #92400e;
  margin-top: 14rpx;
}

.result-card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid #bdebd6;
  border-radius: 20rpx;
  background: #effcf5;
}

.result-title {
  display: block;
  color: #065f46;
  font-size: 29rpx;
  font-weight: 700;
}

.result-main {
  display: block;
  margin-top: 14rpx;
  color: #047857;
  font-size: 27rpx;
}

.result-sub {
  display: block;
  margin-top: 12rpx;
  color: #4b7565;
  font-size: 23rpx;
  line-height: 1.6;
}

.action-row {
  display: flex;
  gap: 16rpx;
  margin-top: 22rpx;
}

.small-button {
  flex: 1;
  margin: 0;
  padding: 0 12rpx;
  min-height: 76rpx;
  line-height: 76rpx;
  border-radius: 12rpx;
  background: #4361ee;
  color: #fff;
  font-size: 25rpx;
}

.small-button.light {
  color: #4361ee;
  background: #fff;
}

.danger-button {
  color: #dc2626;
  background: #fff;
}

/* 操作区：使用 sticky，避免直接 fixed 遮挡内容 */
.submit-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 20rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  border: 2rpx solid #e9edf5;
  border-radius: 18rpx;
  background: #fff;
  box-shadow: 0 -6rpx 24rpx rgba(31, 41, 55, 0.05);
}

.submit-summary {
  flex: 1;
  min-width: 0;
}

.submit-count {
  display: block;
  font-size: 27rpx;
  font-weight: 600;
}

.submit-preview {
  display: block;
  margin-top: 8rpx;
  color: #4361ee;
  font-size: 23rpx;
}

.primary-button {
  margin: 0;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 14rpx;
  color: #fff;
  background: #4361ee;
  font-size: 28rpx;
  font-weight: 600;
}

/* 只读页的次要入口(管理员登录) */
.ghost-button {
  margin: 16rpx 0 0;
  height: 80rpx;
  line-height: 80rpx;
  border-radius: 14rpx;
  color: #4361ee;
  background: #eef2ff;
  font-size: 26rpx;
  font-weight: 500;
}

.submit-button {
  width: 270rpx;
  flex-shrink: 0;
}

button::after {
  border: none;
}

button[disabled] {
  opacity: 0.5;
}

.locked,
.faded {
  opacity: 0.65;
}

/* 只读、加载、空状态 */
.readonly {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64rpx 36rpx;
}

.readonly-icon {
  font-size: 70rpx;
}

.readonly-title {
  margin-top: 20rpx;
  font-size: 33rpx;
  font-weight: 700;
}

.readonly-desc {
  margin: 20rpx 0 36rpx;
  text-align: center;
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.8;
}

.readonly .primary-button {
  width: 100%;
}

.state-card {
  text-align: center;
  padding: 56rpx 28rpx;
}

.state-title {
  display: block;
  margin-bottom: 18rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.secondary-button {
  margin-top: 28rpx;
  background: #eef2ff;
  color: #4361ee;
  font-size: 27rpx;
  border-radius: 12rpx;
}

.empty {
  width: 100%;
  box-sizing: border-box;
  padding: 36rpx 12rpx;
  text-align: center;
  color: #6b7280;
  font-size: 25rpx;
  line-height: 1.7;
}

/* ===== 手机端紧凑录入布局 ===== */

.page {
  padding: 20rpx;
  padding-bottom: 28rpx;
}

.card {
  padding: 24rpx;
  margin-bottom: 20rpx;
  border-radius: 20rpx;
}

.entry-editor {
  overflow: hidden;
}

.compact-heading {
  margin-bottom: 20rpx;
}

/* 六个规则时为两行三列 */
.entry-rule-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.entry-rule-button {
  display: flex;
  align-items: center;
  justify-content: center;

  width: calc((100% - 24rpx) / 3);
  min-height: 44px;
  box-sizing: border-box;
  margin: 0;
  padding: 12rpx 8rpx;

  border: 2rpx solid #e6eaf2;
  border-radius: 12rpx;
  background: #f6f8fc;

  color: #475569;
  font-size: 25rpx;
  font-weight: 500;
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: anywhere;
}

.entry-rule-button.active {
  border-color: #4361ee;
  background: #edf1ff;
  color: #3655e8;
  font-weight: 700;
}

.entry-rule-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
  margin-top: 14rpx;
  color: #64748b;
  font-size: 23rpx;
  line-height: 1.6;
}

.entry-info-divider {
  color: #a1aaba;
}

/* 数量紧跟规则，不隔成员列表 */
.entry-quantity-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 24rpx;
}

.entry-field-label {
  flex-shrink: 0;
  color: #334155;
  font-size: 27rpx;
  font-weight: 600;
}

.entry-quantity-box {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;

  padding: 0 20rpx;
  border: 2rpx solid #dce3f2;
  border-radius: 14rpx;
  background: #fafbff;
}

.entry-quantity-input {
  flex: 1;
  min-width: 0;
  height: 52px;
  color: #18233b;
  font-size: 36rpx;
  font-weight: 700;
}

.entry-quantity-unit {
  max-width: 45%;
  margin-left: 12rpx;
  color: #64748b;
  font-size: 23rpx;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.entry-quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 14rpx;
}

.entry-quick-button {
  display: flex;
  align-items: center;
  justify-content: center;

  flex: 1 1 15%;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 8rpx;

  border-radius: 12rpx;
  background: #edf1ff;
  color: #4361ee;

  font-size: 26rpx;
  line-height: 1.4;
  font-weight: 600;
}

.entry-quick-button.neutral {
  color: #64748b;
  background: #f2f4f7;
}

/* 成员摘要 */
.entry-member-summary {
  width: 100%;
  box-sizing: border-box;
  margin: 24rpx 0 0;
  padding: 20rpx;

  border: 2rpx solid #e8ecf5;
  border-radius: 14rpx;
  background: #f8faff;

  text-align: left;
  line-height: 1.5;
}

.entry-member-summary-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.entry-member-count {
  font-size: 27rpx;
  font-weight: 700;
  color: #334155;
}

.entry-member-edit {
  flex-shrink: 0;
  font-size: 24rpx;
  color: #4361ee;
}

.entry-member-names {
  display: block;
  margin-top: 8rpx;

  font-size: 23rpx;
  color: #64748b;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.entry-restore-button {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 100%;
  min-height: 44px;
  margin: 12rpx 0 0;
  padding: 10rpx 14rpx;

  border-radius: 12rpx;
  background: #fff8e8;
  color: #986309;

  font-size: 23rpx;
  line-height: 1.5;
}

/* 小型预览，不再占用整张大卡片 */
.entry-preview {
  margin-top: 22rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #eef1f6;
}

.entry-preview-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.entry-preview-main {
  flex: 1;
  min-width: 0;
}

.entry-preview-label {
  display: block;
  color: #64748b;
  font-size: 23rpx;
}

.entry-preview-value {
  display: block;
  margin-top: 6rpx;
  color: #4361ee;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.4;
}

.entry-preview-value.is-error {
  color: #dc2626;
}

.entry-note-toggle {
  display: flex;
  align-items: center;
  justify-content: center;

  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 0 8rpx 16rpx;

  background: transparent;
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.4;
}

.entry-preview-sub {
  display: block;
  margin-top: 12rpx;
  color: #718096;
  font-size: 22rpx;
  line-height: 1.6;
}

.entry-warning {
  margin-top: 12rpx;
  padding: 14rpx 16rpx;
  border-radius: 10rpx;
  background: #fff7e6;
  color: #9a6700;
  font-size: 23rpx;
  line-height: 1.6;
}

.entry-note-input {
  margin-top: 18rpx;
}

.entry-save-button {
  width: 100%;
  margin-top: 22rpx;
  min-height: 48px;
  height: auto;
  padding: 12rpx;
  box-sizing: border-box;
  line-height: 1.8;
  font-size: 29rpx;
}

/* 展开的成员编辑区 */
.member-editor-count {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  color: #4361ee;
}

.member-done-small {
  display: flex;
  align-items: center;
  justify-content: center;

  min-width: 64px;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 20rpx;

  border-radius: 12rpx;
  background: #edf1ff;
  color: #4361ee;
  font-size: 26rpx;
  line-height: 1.4;
}

.member-done-button {
  width: 100%;
  margin-top: 24rpx;
  min-height: 48px;
  height: auto;
  padding: 12rpx;
  line-height: 1.8;
}

/* 保证手机触控目标尺寸，避免只缩小字号 */
.member-item {
  min-height: 44px;
}

.member-editor .text-action {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  box-sizing: border-box;
}

.member-editor .filter-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  box-sizing: border-box;
}

.member-editor .member-toolbar {
  gap: 20rpx;
  padding: 8rpx 0;
}

/* 窄屏或长规则名时改为两列，避免挤成难读的小按钮 */
@media screen and (max-width: 350px) {
  .entry-rule-button {
    width: calc((100% - 12rpx) / 2);
  }

  .entry-quantity-row {
    gap: 12rpx;
  }
}

/* ===== 主页面：紧凑工具型布局 ===== */
.page {
  padding: 24rpx;
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
  background: linear-gradient(155deg, #edf3ff, #f6f8fc 460rpx);
  color: #2b3b55;
}

.card {
  padding: 28rpx;
  border: 1px solid #eaf0f8;
  border-radius: 26rpx;
  box-shadow: 0 8rpx 28rpx rgba(47, 70, 116, 0.035);
}

.entry-editor {
  overflow: visible;
}

.entry-eyebrow {
  display: block;
  margin-bottom: 10rpx;
  color: #8f9eba;
  font-size: 17rpx;
  letter-spacing: 3rpx;
  font-weight: 600;
}

.section-title {
  color: #2b3b55;
  font-size: 33rpx;
}

.entry-period {
  display: flex;
  align-items: center;
  padding: 10rpx 14rpx;
  border-radius: 999rpx;
  background: #f1f5fd;
  color: #7f8fab;
  font-size: 20rpx;
}

.period-dot {
  width: 8rpx;
  height: 8rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #8aa3e7;
}

.entry-guide {
  display: flex;
  align-items: center;
  padding: 16rpx 0 24rpx;
  margin-bottom: 22rpx;
  border-bottom: 1px solid #eef2f8;
  color: #8492ab;
  font-size: 21rpx;
}

.guide-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30rpx;
  height: 30rpx;
  margin-right: 8rpx;
  border-radius: 50%;
  background: #edf2ff;
  color: #718bd6;
  font-size: 18rpx;
  font-weight: 700;
}

.guide-line {
  flex: 1;
  height: 1px;
  margin: 0 14rpx;
  background: #e7edf8;
}

.entry-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.entry-label-title {
  flex-shrink: 0;
  color: #586981;
  font-size: 24rpx;
  font-weight: 600;
}

.entry-label-hint {
  color: #98a4b6;
  font-size: 19rpx;
  text-align: right;
}

.entry-rule-button {
  min-height: 46px;
  border: 1px solid #e5ebf5;
  border-radius: 15rpx;
  background: #f8faff;
  color: #64738c;
  font-size: 25rpx;
}

.entry-rule-button.active {
  border-color: #7895ed;
  background: #edf3ff;
  color: #4f73d8;
  box-shadow: inset 0 0 0 1px rgba(101, 134, 233, 0.06);
}

.entry-rule-info {
  margin-top: 16rpx;
  color: #8492a9;
  font-size: 21rpx;
}

.entry-quantity-box {
  border: 1px solid #dfe7f5;
  border-radius: 16rpx;
  background: #f9fbff;
}

.entry-quantity-input {
  height: 52px;
  color: #3e5681;
  font-size: 36rpx;
}

.entry-quick-button {
  border-radius: 14rpx;
  background: #eef3ff;
  color: #6480d5;
}

.quantity-help {
  display: block;
  margin-top: 12rpx;
  color: #98a4b6;
  font-size: 20rpx;
  line-height: 1.7;
}

.entry-member-summary {
  padding: 22rpx;
  border: 1px solid #dfe8fa;
  border-radius: 18rpx;
  background: linear-gradient(120deg, #f2f6ff, #f8faff);
}

.entry-member-count {
  color: #49618b;
}

.entry-member-edit {
  color: #6a86d5;
}

.entry-member-names {
  color: #8796b0;
  font-size: 22rpx;
}

.entry-restore-button {
  background: #fff8eb;
  color: #ab8b52;
  font-size: 21rpx;
}

.entry-preview {
  padding: 22rpx;
  border: none;
  border-radius: 18rpx;
  background: #f8faff;
}

.entry-preview-value {
  color: #5979d3;
  font-size: 33rpx;
  overflow-wrap: anywhere;
}

.entry-save-button {
  min-height: 50px;
  border-radius: 17rpx;
  background: linear-gradient(110deg, #527bf0, #6b65df);
  box-shadow: 0 8rpx 22rpx rgba(80, 108, 218, 0.15);
}

.entry-save-button[disabled] {
  box-shadow: none;
}

/* ===== 选人弹层 ===== */
/*
 * 层级 + 底边约定(两处都踩过坑, 别随手改):
 *   页面内容  <  粘贴星数名单面板 850  <  选人弹层(含"指认"模式) 900  <  tabBar 998  <  uni 弹窗/toast 999
 *
 * 1) 弹层必须 < 999: uni-app H5 的 uni.showModal / uni.showToast 固定在 z-index: 999
 *    (见 uni.css 的 uni-modal / uni-toast), 否则「清空全部选择」这类确认框会被弹层盖住。
 * 2) 弹层也不去跟 tabBar(z-index: 998) 抢层级 —— 998 与 999 之间没有整数, 抢不过就会像现在这样
 *    把底部确认按钮压掉。做法是让弹层整体停在 tabBar 之上:
 *    --window-bottom 是 uni 写在 <html> 上的 tabBar 高度 + 底部安全区(tabBar 页面约 50px + 安全区),
 *    所以 bottom: var(--window-bottom) 恰好让抽屉底边贴在导航栏上沿, 确认按钮完整可见。
 */
.member-picker-layer {
  position: fixed;
  z-index: 900;
  top: 0;
  right: 0;
  bottom: var(--window-bottom, 0px);
  left: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.paste-layer {
  position: fixed;
  z-index: 850;
  top: 0;
  right: 0;
  bottom: var(--window-bottom, 0px);
  left: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.member-picker-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(28, 41, 68, 0.42);
}

.member-picker-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 760px;
  height: 86vh;
  /* 弹层已经让出了 tabBar 的高度, 这里再用 min(...,100%) 兜住, 保证抽屉不会超出可视区、顶部被切掉 */
  max-height: min(900px, 100%);
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 30rpx 30rpx 0 0;
  background: #fff;
  box-shadow: 0 -12rpx 50rpx rgba(21, 38, 73, 0.12);
}

.picker-handle {
  flex-shrink: 0;
  width: 64rpx;
  height: 7rpx;
  margin: 14rpx auto 4rpx;
  border-radius: 999rpx;
  background: #dfe6f1;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 16rpx 28rpx 20rpx;
}

.picker-title {
  display: block;
  color: #30425f;
  font-size: 32rpx;
  font-weight: 700;
}

.picker-subtitle {
  display: block;
  margin-top: 8rpx;
  color: #92a0b5;
  font-size: 21rpx;
}

.picker-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  background: #f4f7fb;
  color: #96a3b9;
  font-size: 40rpx;
  line-height: 1;
}

.picker-controls {
  flex-shrink: 0;
  padding: 0 24rpx;
  border-bottom: 1px solid #eaf0f7;
  background: #fff;
}

.picker-search {
  display: flex;
  align-items: center;
  min-height: 46px;
  padding: 0 18rpx;
  border: 1px solid #e5ecf7;
  border-radius: 16rpx;
  background: #f7faff;
}

.picker-search-symbol {
  margin-right: 12rpx;
  color: #93a4c2;
  font-size: 37rpx;
}

.picker-search-input {
  flex: 1;
  min-width: 0;
  height: 46px;
  color: #3f5475;
  font-size: 26rpx;
}

.picker-search-clear {
  min-height: 44px;
  margin: 0;
  padding: 0 0 0 12rpx;
  background: transparent;
  color: #8b9bb5;
  font-size: 21rpx;
  line-height: 44px;
}

.picker-filters {
  display: flex;
  gap: 10rpx;
  margin-top: 16rpx;
}

.picker-filter {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 4rpx;
  border: 1px solid transparent;
  border-radius: 13rpx;
  background: #f3f6fb;
  color: #7e8fa9;
  font-size: 21rpx;
  line-height: 1.4;
}

.picker-filter.active {
  border-color: #d2defa;
  background: #edf3ff;
  color: #5879cd;
  font-weight: 600;
}

.picker-filter-count {
  margin-left: 6rpx;
  opacity: 0.7;
  font-size: 19rpx;
}

.picker-status-dot {
  flex-shrink: 0;
  width: 11rpx;
  height: 11rpx;
  margin-right: 8rpx;
  border-radius: 50%;
}

.status-green {
  background: #49ab8b;
}

.status-red {
  background: #dd8190;
}

.picker-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  min-height: 48px;
}

.picker-range {
  flex-shrink: 0;
  color: #98a5ba;
  font-size: 20rpx;
}

.picker-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.picker-text-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 0;
  background: transparent;
  color: #6c87cb;
  font-size: 21rpx;
  line-height: 1.4;
}

.selected-only-button.active {
  color: #9b79be;
}

/* 中部滚动区：固定高度由 flex 分配 */
.picker-scroll {
  flex: 1;
  height: 0;
  min-height: 0;
  background: #f6f8fc;
}

.picker-list-content {
  padding: 20rpx 24rpx;
}

.picker-restore {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  min-height: 44px;
  margin: 0 0 18rpx;
  padding: 12rpx 16rpx;
  border: 1px solid #f1e5ce;
  border-radius: 14rpx;
  background: #fff9ed;
  color: #a88a56;
  font-size: 21rpx;
  line-height: 1.6;
  text-align: left;
}

.picker-restore-count {
  flex-shrink: 0;
}

.picker-member-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.picker-member {
  width: calc((100% - 12rpx) / 2);
  min-height: 68px;
  box-sizing: border-box;
  margin: 0;
  padding: 18rpx 14rpx;
  border: 1px solid #e4eaf4;
  border-radius: 16rpx;
  background: #fff;
  text-align: left;
  line-height: 1.5;
}

.picker-member.selected {
  border-color: #7e9bed;
  background: #edf3ff;
  box-shadow: inset 0 0 0 1px rgba(116, 149, 231, 0.06);
}

.picker-member-top {
  display: flex;
  align-items: flex-start;
}

.picker-member-top .picker-status-dot {
  margin-top: 11rpx;
}

.picker-member-name {
  flex: 1;
  min-width: 0;
  color: #566781;
  font-size: 25rpx;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.picker-member.selected .picker-member-name {
  color: #4d6fb9;
  font-weight: 600;
}

.picker-check {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30rpx;
  height: 30rpx;
  box-sizing: border-box;
  margin: 3rpx 0 0 8rpx;
  border: 1px solid #d6dfed;
  border-radius: 9rpx;
  background: #fafcff;
  color: #fff;
  font-size: 21rpx;
}

.picker-member.selected .picker-check {
  border-color: #6c8ce2;
  background: #6c8ce2;
}

.picker-member-tag {
  display: block;
  margin: 8rpx 0 0 19rpx;
  color: #9aa7bb;
  font-size: 19rpx;
  overflow-wrap: anywhere;
}

.picker-list-tip {
  display: block;
  margin: 22rpx 0 8rpx;
  color: #a3afc1;
  font-size: 20rpx;
  line-height: 1.7;
  text-align: center;
}

.picker-empty {
  padding: 64rpx 20rpx;
  text-align: center;
}

.picker-empty-title {
  display: block;
  color: #7f90ab;
  font-size: 27rpx;
}

.picker-empty-description {
  display: block;
  margin-top: 14rpx;
  color: #a1adbf;
  font-size: 22rpx;
}

/* 底部始终可见 */
.picker-footer {
  flex-shrink: 0;
  /* 底部安全区已由弹层的 bottom: var(--window-bottom) 让出, 这里不再重复加 env(safe-area-inset-bottom) */
  padding: 14rpx 24rpx 24rpx;
  border-top: 1px solid #e7edf7;
  background: #fff;
  box-shadow: 0 -6rpx 24rpx rgba(39, 61, 108, 0.035);
}

.picker-hidden-warning {
  padding: 12rpx 16rpx;
  margin-bottom: 6rpx;
  border-radius: 10rpx;
  background: #fff8ea;
  color: #aa8952;
  font-size: 20rpx;
  line-height: 1.6;
}

.picker-footer-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  margin-bottom: 8rpx;
}

.picker-selection-total {
  display: flex;
  align-items: baseline;
  color: #8797af;
  font-size: 23rpx;
}

.picker-selection-number {
  margin: 0 10rpx;
  color: #587bd3;
  font-size: 35rpx;
  font-weight: 700;
}

.picker-clear-all {
  min-height: 44px;
  margin: 0;
  padding: 0;
  background: transparent;
  color: #b0838d;
  font-size: 21rpx;
  line-height: 44px;
}

.picker-confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 48px;
  margin: 0;
  padding: 12rpx;
  border-radius: 16rpx;
  background: linear-gradient(110deg, #567ded, #6b68df);
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.6;
}

/* ---- 粘贴星数名单(识图导入) ---- */
.entry-paste-open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6rpx;
  width: 100%;
  margin: 20rpx 0 0;
  padding: 20rpx 22rpx;
  border: 2rpx dashed #c7d2fe;
  border-radius: 16rpx;
  background: #f7f9ff;
  text-align: left;
  line-height: 1.5;
}

.entry-paste-open-title {
  color: #4361ee;
  font-size: 26rpx;
  font-weight: 600;
}

.entry-paste-open-hint {
  color: #7b879b;
  font-size: 21rpx;
}

.entry-paste-plan {
  margin-top: 20rpx;
  padding: 22rpx;
  border: 2rpx solid #dbe3fb;
  border-radius: 16rpx;
  background: #f7f9ff;
}

.entry-paste-plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.entry-paste-plan-title {
  color: #2f3a56;
  font-size: 26rpx;
  font-weight: 700;
}

.entry-paste-plan-edit {
  color: #4361ee;
  font-size: 23rpx;
}

.entry-paste-plan-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 16rpx;
}

.entry-paste-plan-chip {
  padding: 8rpx 14rpx;
  border-radius: 10rpx;
  background: #fff;
  color: #4361ee;
  font-size: 22rpx;
}

.entry-paste-plan-meta {
  display: block;
  margin-top: 14rpx;
  color: #6b7280;
  font-size: 22rpx;
  line-height: 1.6;
}

.entry-paste-plan-exit {
  display: inline-block;
  margin-top: 16rpx;
  color: #8a93a6;
  font-size: 22rpx;
}

.paste-textarea {
  width: 100%;
  height: 260rpx;
  box-sizing: border-box;
  padding: 20rpx;
  border: 2rpx solid #e5e7eb;
  border-radius: 14rpx;
  background: #f9fafb;
  color: #1f2937;
  font-size: 25rpx;
  line-height: 1.6;
}

.paste-toolbar {
  display: flex;
  gap: 16rpx;
  margin-top: 18rpx;
}

.paste-stats {
  margin: 22rpx 0 6rpx;
  padding: 18rpx 20rpx;
  border-radius: 14rpx;
  background: #eef2ff;
}

.paste-stats-main {
  display: block;
  color: #3b4a6b;
  font-size: 25rpx;
  font-weight: 600;
}

.paste-stats-sub {
  display: block;
  margin-top: 8rpx;
  color: #64748b;
  font-size: 21rpx;
  line-height: 1.6;
}

.paste-group {
  margin-top: 22rpx;
}

.paste-group-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding-bottom: 12rpx;
  border-bottom: 2rpx solid #eef1f7;
}

.paste-star {
  padding: 6rpx 16rpx;
  border-radius: 10rpx;
  background: #4361ee;
  color: #fff;
  font-size: 23rpx;
  font-weight: 700;
}

.paste-star.zero {
  background: #9ca3af;
}

.paste-group-meta {
  color: #6b7280;
  font-size: 22rpx;
}

.paste-rows {
  margin-top: 8rpx;
}

.paste-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid #f4f6fb;
}

.paste-row-main {
  flex: 1;
  min-width: 0;
}

.paste-row-name {
  display: block;
  color: #1f2937;
  font-size: 25rpx;
}

.paste-row-state {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  line-height: 1.5;
}

.paste-row.is-ok .paste-row-state {
  color: #16a34a;
}

.paste-row.is-near .paste-row-state {
  color: #b45309;
}

.paste-row.is-bad .paste-row-state {
  color: #dc2626;
}

.paste-row.is-ignored .paste-row-name,
.paste-row.is-duplicate .paste-row-name,
.paste-row.is-zero .paste-row-name {
  color: #9ca3af;
}

.paste-row.is-ignored .paste-row-state,
.paste-row.is-duplicate .paste-row-state,
.paste-row.is-zero .paste-row-state {
  color: #9ca3af;
}

.paste-row-ops {
  display: flex;
  flex-shrink: 0;
  gap: 18rpx;
}

.paste-alts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx;
  margin-top: 10rpx;
}

.paste-alts-label {
  color: #9aa4b8;
  font-size: 20rpx;
}

.paste-alt {
  padding: 6rpx 14rpx;
  border: 2rpx solid #dbe3fb;
  border-radius: 999rpx;
  background: #fff;
  color: #4361ee;
  font-size: 21rpx;
}

.paste-alt.active {
  border-color: #4361ee;
  background: #eef2ff;
  font-weight: 600;
}

.paste-op {
  padding: 8rpx 0;
  color: #4361ee;
  font-size: 23rpx;
}

.paste-ignored-lines {
  margin-top: 24rpx;
  padding: 16rpx 18rpx;
  border-radius: 12rpx;
  background: #fff8e8;
}

.paste-ignored-title {
  display: block;
  color: #9a6700;
  font-size: 22rpx;
}

.paste-ignored-line {
  display: block;
  margin-top: 6rpx;
  color: #a1740f;
  font-size: 21rpx;
}

/* 窄屏保持触控尺寸，而不是一味缩小按钮 */
@media screen and (max-width: 350px) {
  .entry-period {
    font-size: 18rpx;
    padding: 8rpx 10rpx;
  }

  .picker-filter {
    font-size: 20rpx;
  }

  .picker-filter .picker-status-dot {
    display: none;
  }

  .picker-toolbar-actions {
    gap: 12rpx;
  }

  .picker-member {
    padding-left: 12rpx;
    padding-right: 12rpx;
  }
}

/* 桌面端：主面板限宽，弹层居中 */
@media screen and (min-width: 768px) {
  .page {
    padding-left: max(24px, calc((100% - 840px) / 2));
    padding-right: max(24px, calc((100% - 840px) / 2));
  }

  .member-picker-layer,
  .paste-layer {
    align-items: center;
  }

  .member-picker-sheet {
    width: calc(100% - 48px);
    height: 82vh;
    border-radius: 24px;
  }

  .picker-member {
    width: calc((100% - 24rpx) / 3);
  }
}
</style>