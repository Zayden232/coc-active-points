<template>
  <view class="settings-page">
<!-- 页面标题 -->
<view class="page-heading">
  <view>
    <text class="page-eyebrow">CLAN WORKSPACE</text>
    <text class="page-title">设置中心</text>
    <text class="page-subtitle">管理部落日常，让每一份贡献都有迹可循</text>
  </view>
  <view class="heading-decoration">⚙</view>
</view>

<!-- 身份校验状态：失败时不展示业务操作 -->
<view v-if="!authReady" class="card state-card">
  <text class="state-title">
    {{ authLoading ? '正在确认登录身份…' : '无法确认登录身份' }}
  </text>

  <text v-if="authError" class="description error-text">
    {{ authError }}
  </text>

  <button
    v-if="!authLoading"
    class="button secondary"
    @click="syncIdentity"
  >
    重新验证
  </button>
</view>

<!-- 真实账号身份 -->
<view
  v-if="authReady"
  class="identity-card"
  :class="{
    'identity-super': isSuperAdmin,
    'identity-viewer': !canWrite
  }"
>
  <view class="identity-icon">
    {{ identityAvatar }}
  </view>

  <view class="identity-content">
    <view class="identity-name-row">
      <text class="identity-title">{{ identityName }}</text>
      <text class="identity-badge">{{ roleLabel }}</text>
    </view>

    <text class="identity-account">
      {{ currentUser.username ? '@' + currentUser.username : '部落只读访问' }}
    </text>

    <text class="identity-description">
      {{
        isSuperAdmin
          ? '管理部落配置、管理员账号与数据安全'
          : canWrite
            ? '管理日常积分、奖励预算与业务规则'
            : '查看部落动态、成员积分与排行榜'
      }}
    </text>
  </view>

  <view class="identity-watermark">🏰</view>
</view>

<!-- 账号与安全 -->
<view v-if="authReady && canWrite" class="card account-card">
  <view class="section-heading">
    <view>
      <text class="section-kicker">ACCOUNT & SECURITY</text>
      <text class="section-title">账号与安全</text>
      <text class="section-subtitle">
        使用独立账号，操作记录将关联到当前身份
      </text>
    </view>
    <text class="tag neutral">个人账号</text>
  </view>

  <button
    class="setting-entry"
    :disabled="locked"
    @click="togglePasswordPanel"
  >
    <view class="entry-icon entry-blue">密</view>

    <view class="entry-content">
      <text class="entry-title">修改登录密码</text>
      <text class="entry-description">
        修改成功后需重新登录
      </text>
    </view>

    <text class="entry-arrow">
      {{ passwordPanelOpen ? '−' : '›' }}
    </text>
  </button>

  <!-- 修改密码 -->
  <view v-if="passwordPanelOpen" class="password-panel">
    <text class="field-label">当前密码</text>
    <input
      v-model="passwordForm.oldPassword"
      class="input"
      type="text"
      password
      :disabled="locked"
      placeholder="请输入当前登录密码"
    />

    <text class="field-label">新密码</text>
    <input
      v-model="passwordForm.newPassword"
      class="input"
      type="text"
      password
      :disabled="locked"
      placeholder="请输入新密码"
    />

    <text class="field-label">确认新密码</text>
    <input
      v-model="passwordForm.confirmPassword"
      class="input"
      type="text"
      password
      :disabled="locked"
      placeholder="再次输入新密码"
      confirm-type="done"
      @confirm="changeMyPassword"
    />

    <text class="small-description">
      请使用独立且不易猜测的密码。密码长度与复杂度以服务端规则为准。
    </text>

    <view class="notice warning">
      如果其他区域有未保存内容，请先保存。修改密码成功后将退出当前登录。
    </view>

    <view class="button-row">
      <button
        class="button secondary"
        :disabled="locked"
        @click="closePasswordPanel"
      >
        取消
      </button>

      <button
        class="button primary"
        :disabled="locked"
        @click="changeMyPassword"
      >
        {{ task === 'password' ? '修改中…' : '确认修改' }}
      </button>
    </view>
  </view>

  <!-- 仅超级管理员展示 -->
  <button
    v-if="isSuperAdmin"
    class="setting-entry"
    :disabled="locked"
    @click="openAdminManagement"
  >
    <view class="entry-icon entry-purple">管</view>

    <view class="entry-content">
      <text class="entry-title">管理员管理</text>
      <text class="entry-description">
        新增账号、停用账号、重置密码与强制退出
      </text>
    </view>

    <text class="entry-label">超管专属</text>
    <text class="entry-arrow">›</text>
  </button>

  <view v-if="!isSuperAdmin" class="account-footnote">
    管理员账号由超级管理员统一管理。如需调整权限，请联系超级管理员。
  </view>
</view>

    <!-- 未登录 / 访客: 登录入口 -->
    <view v-if="authReady && !canWrite" class="card account-card">
      <view class="section-heading">
        <view>
          <text class="section-kicker">ACCOUNT</text>
          <text class="section-title">{{ currentUser.role === 'viewer' ? '访客身份' : '账号' }}</text>
          <text class="section-subtitle">
            {{
              currentUser.role === 'viewer'
                ? '访客身份只能查看，不能修改任何数据'
                : '登录管理员账号后即可管理积分、成员与规则'
            }}
          </text>
        </view>
        <text class="tag neutral">{{ roleLabel }}</text>
      </view>

      <button class="setting-entry" :disabled="locked" @click="openLogin">
        <view class="entry-icon entry-blue">登</view>
        <view class="entry-content">
          <text class="entry-title">管理员登录</text>
          <text class="entry-description">使用用户名与密码登录</text>
        </view>
        <text class="entry-arrow">›</text>
      </button>

      <button
        v-if="currentUser.role === 'viewer'"
        class="setting-entry"
        :disabled="locked"
        @click="logout"
      >
        <view class="entry-icon entry-purple">退</view>
        <view class="entry-content">
          <text class="entry-title">退出访客身份</text>
          <text class="entry-description">退出后仍可匿名浏览公开数据</text>
        </view>
        <text class="entry-arrow">›</text>
      </button>
    </view>

    <!-- 访客 -->
    <block v-if="authReady && !canWrite">
      <view class="card">
        <view class="section-heading">
          <text class="section-title">访问权限</text>
          <text class="tag neutral">只读模式</text>
        </view>

        <text class="description">
          可以查看首页、排行榜、成员和积分流水。
          不能录入积分、修改成员、编辑规则、执行结算或恢复备份。
        </text>

        <view class="info-box">
          如需管理权限，请退出后使用管理员身份登录。
        </view>
      </view>
    </block>

    <!-- 管理员 / 超级管理员 -->
    <block v-if="authReady && canWrite">
      <view class="tabs">
        <button
          v-for="item in visibleTabs"
          :key="item.value"
          class="tab-button"
          :class="{ active: tab === item.value }"
          :disabled="locked"
          @click="tab = item.value"
        >
          {{ item.label }}
          <text
            v-if="item.value === 'rewards' && settingsDirty"
            class="dirty-dot"
          ></text>
          <text
            v-if="item.value === 'rules' && editorOpen"
            class="dirty-dot"
          ></text>
        </button>
      </view>

      <view v-if="!ready" class="card state-card">
        <text class="state-title">
          {{ loading ? '正在加载设置…' : '暂时无法加载设置' }}
        </text>

        <text v-if="loadError" class="description error-text">
          {{ loadError }}
        </text>

        <button
          v-if="!loading"
          class="button secondary"
          @click="load"
        >
          重新加载
        </button>
      </view>

      <block v-else>
        <view class="page-toolbar">
          <text class="toolbar-hint">
            {{ loading ? '刷新中…' : '设置以服务器保存结果为准' }}
          </text>

          <button
            class="text-button"
            :disabled="locked"
            @click="refreshAll"
          >
            刷新
          </button>
        </view>

        <view v-if="loadError" class="notice warning">
          {{ loadError }}
        </view>

        <!-- 奖励预算 -->
        <block v-if="tab === 'rewards'">
          <view class="card">
            <view class="section-heading">
              <view>
                <text class="section-title">奖励金额</text>
                <text class="section-subtitle">
                  修改后需保存，不应追溯覆盖已结算奖励
                </text>
              </view>

              <text v-if="settingsDirty" class="tag warning-tag">
                未保存
              </text>
            </view>

            <view
              v-for="item in rewardFields"
              :key="item.key"
              class="reward-row"
            >
              <view class="reward-label">
                <text class="reward-name">{{ item.label }}</text>
                <text class="reward-period">{{ item.period }}</text>
              </view>

              <view class="money-input-box">
                <input
                  v-model="settings[item.key]"
                  class="money-input"
                  type="digit"
                  maxlength="14"
                  :disabled="locked"
                  placeholder="0.00"
                />
                <text class="money-unit">元</text>
              </view>
            </view>

            <view class="cycle-box">
              <view class="cycle-line">
                <text>周期起点</text>
                <text class="cycle-value">固定周一</text>
              </view>
              <view class="cycle-line">
                <text>月 / 赛季</text>
                <text class="cycle-value">连续 4 周 / 连续 12 周</text>
              </view>

              <text class="small-description">
                沿用系统原有周期锚点，不在这里调整历史周期。
              </text>
            </view>

            <view v-if="cycleConflict" class="notice danger-notice">
              服务端当前起始日不是周一，或未返回有效值。
              已暂停保存奖励设置，请先检查周期配置，避免改变历史归属。
            </view>

            <view class="draft-budget">
              <view>
                <text class="draft-label">
                  {{ settingsDirty ? '按当前草稿估算' : '按当前金额估算' }}
                </text>
                <text class="small-description">
                  12 次周奖 + 3 次四周月奖 + 1 次赛季奖
                </text>
              </view>

              <text class="draft-amount">
                {{ draftTotal === null ? '—' : '¥' + draftTotal }}
              </text>
            </view>

            <view class="button-row">
              <button
                class="button secondary"
                :disabled="locked || !settingsDirty"
                @click="resetSettings"
              >
                重置修改
              </button>

              <button
                class="button primary"
                :disabled="
                  locked ||
                  !settingsDirty ||
                  cycleConflict ||
                  draftTotal === null
                "
                @click="saveSettings"
              >
                {{ task === 'settings' ? '保存中…' : '保存奖励设置' }}
              </button>
            </view>
          </view>

          <view class="card">
            <view class="section-heading">
              <view>
                <text class="section-title">服务器预算</text>
                <text class="section-subtitle">
                  以下为已保存配置，不包含未保存草稿
                </text>
              </view>
              <text class="tag neutral">12 周</text>
            </view>

            <view v-if="budgetError" class="notice warning">
              {{ budgetError }}
            </view>

            <view
              v-for="(line, index) in budget.lines"
              :key="index"
              class="budget-line"
            >
              <view>
                <text class="budget-name">{{ line.name }}</text>
                <text class="budget-detail">
                  ¥{{ money(line.amount) }} × {{ line.times }} 次
                </text>
              </view>
              <text class="budget-value">
                ¥{{ money(line.subtotal) }}
              </text>
            </view>

            <view v-if="!budget.lines.length" class="empty">
              暂无预算明细
            </view>

            <view class="budget-summary">
              <view class="budget-metric">
                <text class="metric-label">计划合计</text>
                <text class="metric-value">
                  ¥{{ money(budget.total) }}
                </text>
              </view>
              <view class="budget-metric">
                <text class="metric-label">已发放</text>
                <text class="metric-value green">
                  ¥{{ money(budget.paid) }}
                </text>
              </view>
            </view>
          </view>
        </block>

        <!-- 积分规则 -->
        <block v-if="tab === 'rules'">
          <view class="card">
            <view class="section-heading">
              <view>
                <text class="section-title">积分规则</text>
                <text class="section-subtitle">
                  {{ enabledCount }} 项启用 · 共 {{ rules.length }} 项
                </text>
              </view>

              <button
                class="compact-button"
                :disabled="locked"
                @click="openRuleEditor()"
              >
                ＋ 新增
              </button>
            </view>

            <input
              v-model="ruleKeyword"
              class="input search-input"
              placeholder="搜索规则名称或单位"
            />

            <view class="small-description">
              停用只应阻止新增录入，不应删除历史积分。
            </view>
          </view>

          <!-- 编辑器在列表上方，不直接插入默认数据库记录 -->
          <view
            v-if="editorOpen"
            id="rule-editor"
            class="card editor-card"
          >
            <view class="section-heading">
              <text class="section-title">
                {{ editingId === null ? '新增积分规则' : '编辑积分规则' }}
              </text>
              <text class="tag">编辑中</text>
            </view>

            <text class="field-label">规则名称</text>
            <input
              v-model="editForm.name"
              class="input"
              maxlength="50"
              :disabled="locked"
              placeholder="例如：部落战三星"
            />

            <text class="field-label">数量单位</text>
            <input
              v-model="editForm.unit"
              class="input"
              maxlength="30"
              :disabled="locked"
              placeholder="例如：次、星、每100兵力"
            />

            <view class="form-columns">
              <view class="form-column">
                <text class="field-label">每单位分值</text>
                <input
                  v-model="editForm.score_per_unit"
                  class="input"
                  type="digit"
                  maxlength="16"
                  :disabled="locked"
                  placeholder="例如：3"
                />
              </view>

              <view class="form-column">
                <text class="field-label">每周积分上限</text>
                <input
                  v-model="editForm.weekly_cap"
                  class="input"
                  type="digit"
                  maxlength="16"
                  :disabled="locked"
                  placeholder="留空表示不限"
                />
              </view>
            </view>

            <text class="field-label">录入页快捷数量（可选）</text>
            <input
              v-model="editForm.quick_values"
              class="input"
              maxlength="64"
              :disabled="locked"
              placeholder="例如：100,500,1000（留空则用 1/2/5）"
            />

            <text class="small-description">
              上限是每位成员该规则每周可获得的积分，不是录入数量。
              留空为不限，填写 0 表示上限为 0 分。<br />
              快捷数量必须与录入时填写的「数量」同一单位（系统不做任何换算），最多 4 个正数。
            </text>

            <view v-if="editingId === null" class="editor-status">
              <text>新增后立即启用</text>
              <switch
                :checked="editForm.enabled"
                :disabled="locked"
                color="#5266e8"
                @change="editForm.enabled = $event.detail.value"
              />
            </view>

            <view v-else class="notice warning">
              修改分值或上限可能影响计分。历史规则版本和已结算保护
              必须由后端处理，前端不会自动迁移历史数据。
            </view>

            <view class="button-row">
              <button
                class="button secondary"
                :disabled="locked"
                @click="cancelRuleEditor"
              >
                取消
              </button>
              <button
                class="button primary"
                :disabled="locked"
                @click="saveRule"
              >
                {{
                  task === 'rule-save'
                    ? '保存中…'
                    : editingId === null
                      ? '创建规则'
                      : '保存修改'
                }}
              </button>
            </view>
          </view>

          <view
            v-for="rule in filteredRules"
            :key="rule.id"
            class="card rule-card"
            :class="{ 'rule-disabled': !rule.enabled }"
          >
            <view class="section-heading">
              <view class="rule-title-group">
                <text class="rule-avatar">
                  {{ rule.name ? rule.name.slice(0, 1) : '积' }}
                </text>
                <view class="rule-name-group">
                  <text class="rule-name">{{ rule.name }}</text>
                  <text class="rule-unit">
                    数量单位：{{ rule.unit || '单位' }}
                  </text>
                </view>
              </view>

              <!-- 使用受控状态按钮，避免原生 switch 失败后视觉残留 -->
              <button
                class="status-button"
                :class="{ enabled: rule.enabled }"
                :disabled="locked"
                @click="toggleRule(rule)"
              >
                {{
                  task === 'toggle-' + rule.id
                    ? '处理中'
                    : rule.enabled
                      ? '已启用'
                      : '已停用'
                }}
              </button>
            </view>

            <view class="rule-metrics">
              <view>
                <text class="metric-label">每单位分值</text>
                <text class="rule-score">
                  {{ rule.score_per_unit }}
                  <text class="score-unit">分</text>
                </text>
              </view>

              <view>
                <text class="metric-label">每人每周上限</text>
                <text class="rule-score">
                  {{
                    rule.weekly_cap === null
                      ? '不限'
                      : rule.weekly_cap
                  }}
                  <text
                    v-if="rule.weekly_cap !== null"
                    class="score-unit"
                  >
                    分
                  </text>
                </text>
              </view>

              <button
                class="edit-button"
                :disabled="locked"
                @click="openRuleEditor(rule)"
              >
                编辑
              </button>
            </view>
          </view>

          <view v-if="!filteredRules.length" class="card empty">
            {{ ruleKeyword.trim() ? '没有匹配的规则' : '还没有积分规则' }}
          </view>
        </block>

        <!-- 数据管理 -->
        <block v-if="tab === 'data'">
          <view class="card">
            <view class="section-heading">
              <view>
                <text class="section-title">导出与备份</text>
                <text class="section-subtitle">
                  {{
                    isSuperAdmin
                      ? '导出业务报表，或下载用于恢复的业务备份'
                      : '导出本周排行榜与积分流水，便于核对和归档'
                  }}
                </text>
              </view>
            </view>

            <view class="data-grid">
              <button
                class="data-tile"
                :disabled="locked"
                @click="exportCsv('ranking')"
              >
                <text class="data-icon blue-icon">榜</text>
                <text class="data-title">本周排行榜</text>
                <text class="data-subtitle">CSV 表格</text>
              </button>

              <button
                class="data-tile"
                :disabled="locked"
                @click="exportCsv('records')"
              >
                <text class="data-icon green-icon">账</text>
                <text class="data-title">本周积分流水</text>
                <text class="data-subtitle">CSV 表格</text>
              </button>

              <button
                v-if="isSuperAdmin"
                class="data-tile wide-tile"
                :disabled="locked"
                @click="backup"
              >
                <text class="data-icon purple-icon">备</text>
                <view class="backup-tile-text">
                  <text class="data-title">下载 JSON 备份</text>
                  <text class="data-subtitle">
                    具体备份范围以服务端实现为准
                  </text>
                </view>
                <text class="tile-arrow">›</text>
              </button>
            </view>

            <view v-if="task.startsWith('download')" class="info-box">
              正在处理下载，请稍候…
            </view>

            <text class="small-description">
              下载操作返回不代表文件已进入手机相册或下载目录，
              请自行确认文件已保存。
              AI 图库等外部文件是否包含在备份中，需要单独核对。
            </text>
          </view>

          <view v-if="isSuperAdmin" class="card danger-card">
            <view class="section-heading">
              <view>
                <text class="section-title danger-text">恢复备份</text>
                <text class="section-subtitle">
                  高风险操作，可能覆盖现有业务数据
                </text>
              </view>
              <text class="tag danger-tag">谨慎操作</text>
            </view>

            <text class="description">
              只恢复来自可信来源、与当前版本兼容的备份。
              JSON 格式正确不代表内容有效。
            </text>

            <button
              class="button danger-light"
              :disabled="locked"
              @click="showRestore = !showRestore"
            >
              {{ showRestore ? '收起恢复面板' : '展开恢复面板' }}
            </button>

            <view v-if="showRestore" class="restore-panel">
              <text class="field-label">备份 JSON</text>
              <textarea
                v-model="restoreText"
                class="restore-textarea"
                :maxlength="restoreMaxChars"
                :disabled="locked"
                placeholder="粘贴备份 JSON。超过本页面容量的大备份请使用运维恢复流程。"
              />

              <text class="small-description">
                已输入 {{ restoreText.length }} 个字符。
                本页最多 {{ restoreMaxChars }} 个字符。
              </text>

              <checkbox-group
                @change="restoreAcknowledged = $event.detail.value.includes('ack')"
              >
                <label class="ack-row">
                  <checkbox
                    value="ack"
                    :checked="restoreAcknowledged"
                    :disabled="locked"
                    color="#dc5962"
                  />
                  <text>
                    我已另存当前数据，理解恢复可能覆盖现有记录
                  </text>
                </label>
              </checkbox-group>

              <text class="field-label">
                输入“恢复备份”确认
              </text>

              <input
                v-model="restorePhrase"
                class="input"
                :disabled="locked"
                placeholder="恢复备份"
              />

              <button
                class="button danger-solid"
                :disabled="
                  locked ||
                  !restoreAcknowledged ||
                  restorePhrase.trim() !== '恢复备份' ||
                  !restoreText.trim()
                "
                @click="doRestore"
              >
                {{ task === 'restore' ? '恢复中，请勿重复操作…' : '确认恢复数据' }}
              </button>
            </view>
          </view>

          <view v-if="!isSuperAdmin" class="card permission-card">
            <view class="section-heading">
              <text class="section-title">数据安全</text>
              <text class="tag neutral">权限说明</text>
            </view>

            <text class="description">
              当前账号可以导出业务报表。
              完整备份下载、备份恢复及其他高风险操作，仅对超级管理员开放。
            </text>
          </view>
        </block>
      </block>
    </block>

    <button
      class="logout-button"
      :disabled="locked"
      @click="logout"
    >
      退出登录
    </button>

    <text class="footer-note">
      部落活跃积分 · 设置中心
    </text>
  </view>
</template>

<script>
import {
  get,
  post,
  put,
  downloadFile,
  clearAuth,
} from '@/utils/api';

import { setBrowserTitle } from '@/utils/h5';

// 本页依赖的后端契约(服务端会二次校验, 不信任前端):
//   GET  /api/settings      -> { week_start_day, reward_week_amount, reward_month_amount, reward_season_amount, ... } (admin)
//   PUT  /api/settings      -> 只接受 EDITABLE_KEYS; 本页固定提交 week_start_day='1' + 三项金额
//   GET  /api/budget        -> { lines:[{name,amount,times,subtotal}], total, paid } (admin)
//   GET  /api/rules         -> [{ id, name, unit, score_per_unit, weekly_cap, enabled, sort_order }]
//   POST /api/rules         -> 新建规则(不再像旧版一点击就写库); 同名返回 409
//   PUT  /api/rules/:id     -> **部分更新**: 只提交要改的字段(启停只发 {enabled}, 编辑只发表单字段), 后端按白名单更新
// 账号体系: 身份以 GET /auth/me 为准(未登录=guest 只读); 改密走 POST /auth/change-password(校验旧密码, 成功后旧 Token 全部失效)
// 权限: 完整备份下载与备份恢复仅超级管理员(服务端 requireSuperAdmin 强制); 网页备份只含业务表白名单, 不含账号与安全审计。
//   GET  /api/export?type=week&kind=ranking|records  /  GET /api/backup  /  POST /api/restore
// 周期口径: 后端按 week_start_day 计算, 生产环境为 '1'(周一)。本页不允许改动历史周期,
// 若服务端返回非 '1' 则暂停保存并提示(cycleConflict)。
// 规则数值: score_rules.score_per_unit / weekly_cap 为 DECIMAL(10,2), 前端按两位小数校验。

const REWARD_KEYS = [
  'reward_week_amount',
  'reward_month_amount',
  'reward_season_amount',
];

function emptyRuleForm() {
  return {
    name: '',
    unit: '',
    score_per_unit: '',
    weekly_cap: '',
    quick_values: '',
    enabled: true,
  };
}

function isEnabled(value) {
  return value === true || value === 1 || value === '1';
}

/**
 * 奖金统一转成整数分进行前端估算，
 * 避免 0.1 + 0.2 类浮点问题。
 */
function parseMoney(value) {
  const text = String(value ?? '').trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('金额须为非负数，最多保留两位小数');
  }

  const [whole, fraction = ''] = text.split('.');
  const cents =
    Number(whole) * 100 +
    Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(cents)) {
    throw new Error('金额过大');
  }

  return cents;
}

function formatCents(cents) {
  return (
    Math.floor(cents / 100) +
    '.' +
    String(cents % 100).padStart(2, '0')
  );
}

/**
 * 规则字段精度与数据库对齐:
 * score_rules.score_per_unit / weekly_cap 均为 DECIMAL(10,2),
 * 因此整数部分最多 8 位, 最多两位小数 (上限 99999999.99)。
 * 超出范围前端直接拦下, 避免 MySQL 静默四舍五入。
 */
function parseRuleNumber(value, label, allowZero) {
  const text = String(value ?? '').trim();

  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label}须为非负数, 整数最多 8 位, 最多两位小数`);
  }

  const number = Number(text);

  if (
    !Number.isFinite(number) ||
    !Number.isSafeInteger(Math.round(number * 100)) ||
    (!allowZero && number <= 0)
  ) {
    throw new Error(
      allowZero
        ? `${label}超出有效范围`
        : `${label}必须大于 0 且在有效范围内`
    );
  }

  return number;
}

export default {
  data() {
    return {
      canWrite: false,
      active: false,
      ready: false,
      loading: false,
      task: '',
      requestId: 0,
      authEpoch: 0,

      loadError: '',
      budgetError: '',

      tab: 'rewards',

      // 身份以服务端 /auth/me 为准(本地角色只作提示)
      authReady: false,
      authLoading: false,
      authError: '',
      identityRequestId: 0,
      currentUser: {
        id: null,
        username: '',
        displayName: '',
        role: '',
      },

      passwordPanelOpen: false,
      passwordForm: {
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      },

      rewardFields: [
        {
          key: 'reward_week_amount',
          label: '周奖',
          period: '每 1 周 · 每赛季 12 次',
        },
        {
          key: 'reward_month_amount',
          label: '四周月奖',
          period: '每 4 周 · 每赛季 3 次',
        },
        {
          key: 'reward_season_amount',
          label: '赛季奖',
          period: '每 12 周 · 每赛季 1 次',
        },
      ],

      settings: {
        week_start_day: '',
        reward_week_amount: '',
        reward_month_amount: '',
        reward_season_amount: '',
      },
      savedSettings: null,

      budget: {
        lines: [],
        total: null,
        paid: null,
      },

      rules: [],
      ruleKeyword: '',
      editorOpen: false,
      editingId: null,
      editForm: emptyRuleForm(),

      showRestore: false,
      restoreText: '',
      restorePhrase: '',
      restoreAcknowledged: false,
      restoreMaxChars: 500000,
    };
  },

  computed: {
    locked() {
      return this.authLoading || this.loading || Boolean(this.task);
    },

    isSuperAdmin() {
      return this.authReady && this.currentUser.role === 'super_admin';
    },

    roleLabel() {
      const labels = {
        super_admin: '超级管理员',
        admin: '管理员',
        viewer: '只读访客',
        guest: '未登录 · 只读',
      };

      return labels[this.currentUser.role] || '未验证';
    },

    identityName() {
      return this.currentUser.displayName || this.currentUser.username || '部落访客';
    },

    identityAvatar() {
      if (this.currentUser.role === 'viewer' || this.currentUser.role === 'guest') return '访';
      return this.identityName.slice(0, 1);
    },

    visibleTabs() {
      return [
        { value: 'rewards', label: '奖励预算' },
        { value: 'rules', label: '积分规则' },
        {
          value: 'data',
          label: this.isSuperAdmin ? '数据安全' : '数据导出',
        },
      ];
    },

    settingsDirty() {
      if (!this.savedSettings) return false;

      return REWARD_KEYS.some(
        (key) =>
          String(this.settings[key]) !==
          String(this.savedSettings[key])
      );
    },

    cycleConflict() {
      return String(this.settings.week_start_day) !== '1';
    },

    draftTotal() {
      try {
        const week = parseMoney(this.settings.reward_week_amount);
        const month = parseMoney(this.settings.reward_month_amount);
        const season = parseMoney(this.settings.reward_season_amount);

        const total = week * 12 + month * 3 + season;

        if (!Number.isSafeInteger(total)) return null;

        return formatCents(total);
      } catch {
        return null;
      }
    },

    enabledCount() {
      return this.rules.filter((rule) => rule.enabled).length;
    },

    filteredRules() {
      const keyword = this.ruleKeyword.trim().toLowerCase();

      if (!keyword) return this.rules;

      return this.rules.filter((rule) =>
        `${rule.name || ''} ${rule.unit || ''}`
          .toLowerCase()
          .includes(keyword)
      );
    },

    hasDrafts() {
      return (
        this.settingsDirty ||
        this.editorOpen ||
        Boolean(this.restoreText.trim()) ||
        Boolean(
          this.passwordForm.oldPassword ||
            this.passwordForm.newPassword ||
            this.passwordForm.confirmPassword
        )
      );
    },
  },

  onShow() {
    this.active = true;
    setBrowserTitle();
    this.syncIdentity();
  },

  onHide() {
    this.active = false;

    this.requestId += 1;
    this.identityRequestId += 1;
    this.authEpoch += 1;

    this.loading = false;
    this.authLoading = false;
    this.authReady = false;

    // 不在页面隐藏期间保留密码明文输入。
    this.resetPasswordForm();

    // 离开时有写入请求: 回页面后重新读取服务器状态。
    if (this.task) this.ready = false;
  },

  onUnload() {
    this.active = false;
    this.requestId += 1;
    this.identityRequestId += 1;
    this.authEpoch += 1;
    this.resetPasswordForm();
  },

  methods: {
    toast(title, success = false) {
      uni.showToast({
        title,
        icon: success ? 'success' : 'none',
        duration: 2600,
      });
    },

    confirm(title, content) {
      return new Promise((resolve) => {
        uni.showModal({
          title,
          content,
          success: (result) => resolve(Boolean(result.confirm)),
          fail: () => resolve(false),
        });
      });
    },

    money(value) {
      if (value === null || value === undefined || value === '') {
        return '—';
      }

      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(2) : '—';
    },

    clearAdminState() {
      this.requestId += 1;
      this.loading = false;
      this.ready = false;

      this.savedSettings = null;
      this.settings = {
        week_start_day: '',
        reward_week_amount: '',
        reward_month_amount: '',
        reward_season_amount: '',
      };

      this.rules = [];
      this.budget = { lines: [], total: null, paid: null };
      this.editorOpen = false;
      this.editingId = null;
      this.editForm = emptyRuleForm();

      this.restoreText = '';
      this.restorePhrase = '';
      this.restoreAcknowledged = false;
      this.showRestore = false;

      this.ruleKeyword = '';
      this.resetPasswordForm();

      this.loadError = '';
      this.budgetError = '';
    },

    normalizeSettings(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('设置接口返回格式异常');
      }

      return {
        week_start_day: String(data.week_start_day ?? ''),
        reward_week_amount: String(data.reward_week_amount ?? ''),
        reward_month_amount: String(data.reward_month_amount ?? ''),
        reward_season_amount: String(data.reward_season_amount ?? ''),
      };
    },

    normalizeRules(data) {
      if (!Array.isArray(data)) {
        throw new Error('规则接口返回格式异常');
      }

      return data.map((rule) => ({
        ...rule,
        name: String(rule.name || ''),
        unit: String(rule.unit || ''),
        enabled: isEnabled(rule.enabled),
        weekly_cap:
          rule.weekly_cap === null || rule.weekly_cap === undefined
            ? null
            : rule.weekly_cap,
        // 接口返回数组; 手工把 DB 字符串兼容一下
        quick_values: Array.isArray(rule.quick_values)
          ? rule.quick_values
          : String(rule.quick_values || '')
              .split(',')
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n) && n > 0),
      }));
    },

    normalizeBudget(data) {
      if (!data || !Array.isArray(data.lines)) {
        throw new Error('预算接口返回格式异常');
      }

      return {
        lines: data.lines,
        total: data.total ?? null,
        paid: data.paid ?? null,
      };
    },

    async load() {
      if (!this.active || !this.authReady || !this.canWrite || this.locked) return;

      const requestId = ++this.requestId;
      const epoch = this.authEpoch;

      this.loading = true;
      this.loadError = '';

      try {
        const [settings, budget, rules] = await Promise.all([
          get('/settings'),
          get('/budget'),
          get('/rules'),
        ]);

        // 全部验证后再更新，避免半更新状态。
        const nextSettings = this.normalizeSettings(settings);
        const nextBudget = this.normalizeBudget(budget);
        const nextRules = this.normalizeRules(rules);

        if (
          !this.active ||
          !this.authReady ||
          requestId !== this.requestId ||
          epoch !== this.authEpoch ||
          !this.canWrite
        ) {
          return;
        }

        this.settings = { ...nextSettings };
        this.savedSettings = { ...nextSettings };
        this.budget = nextBudget;
        this.rules = nextRules;
        this.budgetError = '';
        this.ready = true;
      } catch (error) {
        if (
          this.active &&
          requestId === this.requestId &&
          epoch === this.authEpoch
        ) {
          this.loadError = error.message || '加载失败，请重试';
        }
      } finally {
        if (requestId === this.requestId) {
          this.loading = false;
        }
      }
    },

    async refreshAll() {
      if (this.locked) return;

      if (this.hasDrafts) {
        const confirmed = await this.confirm(
          '刷新设置',
          '刷新会丢弃未保存的奖励、规则编辑、恢复文本和密码输入，是否继续？'
        );

        if (!confirmed || this.locked) return;
      }

      this.editorOpen = false;
      this.editingId = null;
      this.editForm = emptyRuleForm();
      this.restoreText = '';
      this.restorePhrase = '';
      this.restoreAcknowledged = false;
      this.resetPasswordForm();

      await this.load();
    },

    /**
     * 全局操作锁：
     * 获取锁后才弹确认框，避免多个弹窗和重复写入。
     */
    async operate(name, handler, superOnly = false) {
      if (this.locked || !this.active || !this.authReady || !this.canWrite) return;

      if (superOnly && !this.isSuperAdmin) {
        this.toast('此操作仅限超级管理员');
        return;
      }

      const epoch = this.authEpoch;
      const userId = this.currentUser.id;
      this.task = name;

      const valid = () =>
        this.active &&
        this.authReady &&
        epoch === this.authEpoch &&
        userId === this.currentUser.id &&
        this.canWrite &&
        (!superOnly || this.isSuperAdmin);

      try {
        await handler(valid);
      } catch (error) {
        if (valid()) {
          this.toast(error.message || '操作失败，请核对后重试');
        }
      } finally {
        if (this.task === name) this.task = '';

        // 处理"离开页面又返回, 上一个写请求刚结束"的情况
        if (this.active && this.authReady && this.canWrite && !this.ready && !this.locked) {
          this.load();
        }
      }
    },

    async resetSettings() {
      if (this.locked || !this.savedSettings) return;

      const confirmed = await this.confirm(
        '重置修改',
        '恢复为上次读取或保存成功的奖励金额？'
      );

      if (confirmed && !this.locked) {
        this.settings = { ...this.savedSettings };
      }
    },

    async saveSettings() {
      if (!this.settingsDirty || this.cycleConflict) return;

      await this.operate('settings', async (valid) => {
        const payload = {
          // 保持周一起点，不允许在此改变历史周期。
          week_start_day: '1',
          reward_week_amount: formatCents(
            parseMoney(this.settings.reward_week_amount)
          ),
          reward_month_amount: formatCents(
            parseMoney(this.settings.reward_month_amount)
          ),
          reward_season_amount: formatCents(
            parseMoney(this.settings.reward_season_amount)
          ),
        };

        const confirmed = await this.confirm(
          '保存奖励金额',
          `按当前金额估算，一个十二周赛季合计 ¥${this.draftTotal}。是否保存？`
        );

        if (!confirmed || !valid() || !this.active) return;

        await put('/settings', payload);

        if (!valid()) return;

        // 只更新当前设置，不全量 load 覆盖其他编辑草稿。
        this.settings = { ...payload };
        this.savedSettings = { ...payload };
        this.toast('奖励设置已保存', true);

        try {
          const budget = await get('/budget');
          if (!valid()) return;

          this.budget = this.normalizeBudget(budget);
          this.budgetError = '';
        } catch {
          if (valid()) {
            this.budgetError =
              '奖励金额已保存，但预算刷新失败；下方可能仍是旧数据，请刷新核对。';
          }
        }
      });
    },

    async openRuleEditor(rule = null) {
      if (this.locked) return;

      if (this.editorOpen) {
        const confirmed = await this.confirm(
          '切换规则编辑',
          '当前编辑内容尚未提交，是否放弃并打开新的编辑内容？'
        );

        if (!confirmed || this.locked) return;
      }

      this.editingId = rule ? rule.id : null;
      this.editForm = rule
        ? {
            name: rule.name,
            unit: rule.unit,
            score_per_unit: String(rule.score_per_unit),
            weekly_cap:
              rule.weekly_cap === null
                ? ''
                : String(rule.weekly_cap),
            quick_values: (Array.isArray(rule.quick_values) ? rule.quick_values : [])
              .join(','),
            enabled: rule.enabled,
          }
        : emptyRuleForm();

      this.editorOpen = true;

      this.$nextTick(() => {
        uni.pageScrollTo({
          scrollTop: 0,
          duration: 180,
        });
      });
    },

    async cancelRuleEditor() {
      if (this.locked) return;

      const confirmed = await this.confirm(
        '取消编辑',
        '放弃当前规则编辑内容？'
      );

      if (!confirmed || this.locked) return;

      this.editorOpen = false;
      this.editingId = null;
      this.editForm = emptyRuleForm();
    },

    async saveRule() {
      if (!this.editorOpen) return;

      await this.operate('rule-save', async (valid) => {
        const id = this.editingId;
        const form = { ...this.editForm };

        const name = form.name.trim();
        const unit = form.unit.trim();

        if (!name) throw new Error('请填写规则名称');
        if (name.length > 50 || unit.length > 30) {
          throw new Error('规则名称或单位过长');
        }

        const payload = {
          name,
          unit,
          score_per_unit: parseRuleNumber(
            form.score_per_unit,
            '每单位分值',
            false
          ),
          weekly_cap:
            String(form.weekly_cap).trim() === ''
              ? null
              : parseRuleNumber(
                  form.weekly_cap,
                  '每周积分上限',
                  true
                ),
          // 快捷数量: 允许逗号分隔; 只保留正数, 最多 4 个(后端还会再清洗一次)
          quick_values: [
            ...new Set(
              String(form.quick_values || '')
                .split(/[,，\s]+/)
                .map((x) => Number(x))
                .filter((n) => Number.isFinite(n) && n > 0)
            ),
          ].slice(0, 4),
        };

        if (id === null) {
          payload.enabled = form.enabled ? 1 : 0;
        }

        const confirmed = await this.confirm(
          id === null ? '创建规则' : '保存规则',
          id === null
            ? `创建“${name}”？`
            : '修改计分规则应由后端保留历史口径。确认保存当前修改？'
        );

        if (!confirmed || !valid() || !this.active) return;

        if (id === null) {
          await post('/rules', payload);
        } else {
          await put(`/rules/${encodeURIComponent(id)}`, payload);
        }

        if (!valid()) return;

        this.editorOpen = false;
        this.editingId = null;
        this.editForm = emptyRuleForm();

        try {
          const rules = await get('/rules');
          if (valid()) this.rules = this.normalizeRules(rules);
        } catch {
          if (valid()) {
            this.toast('规则已保存，但列表刷新失败，请手动刷新');
          }
          return;
        }

        this.toast(id === null ? '规则已创建' : '规则已保存', true);
      });
    },

    async toggleRule(rule) {
      await this.operate(`toggle-${rule.id}`, async (valid) => {
        const target = !rule.enabled;

        const confirmed = await this.confirm(
          target ? '启用规则' : '停用规则',
          target
            ? `启用“${rule.name}”，允许后续录入？`
            : `停用“${rule.name}”？历史记录应保留，后续不能再使用此规则录入。`
        );

        if (!confirmed || !valid() || !this.active) return;

        await put(
          `/rules/${encodeURIComponent(rule.id)}`,
          { enabled: target }
        );

        if (!valid()) return;

        // 成功后再改本地，失败保持原状态。
        this.rules = this.rules.map((item) =>
          item.id === rule.id
            ? { ...item, enabled: target }
            : item
        );

        this.toast(target ? '已启用' : '已停用', true);
      });
    },

    async exportCsv(kind) {
      if (!['ranking', 'records'].includes(kind)) return;

      await this.operate(`download-${kind}`, async (valid) => {
        const date = new Date().toISOString().slice(0, 10);

        await downloadFile(
          `/export?type=week&kind=${kind}`,
          `${kind}-week-${date}.csv`
        );

        if (valid() && this.active) {
          this.toast('下载操作已完成，请确认文件已保存');
        }
      });
    },

    async backup() {
      await this.operate(
        'download-backup',
        async (valid) => {
        const stamp = new Date().toISOString()
          .replace(/[:.]/g, '-');

        await downloadFile(
          '/backup',
          `coc-backup-${stamp}.json`
        );

        if (valid() && this.active) {
          this.toast('请确认备份文件已下载并妥善保存');
        }
        },
        true
      );
    },

    async doRestore() {
      await this.operate(
        'restore',
        async (valid) => {
        if (
          !this.restoreAcknowledged ||
          this.restorePhrase.trim() !== '恢复备份'
        ) {
          throw new Error('请完成恢复风险确认');
        }

        const text = this.restoreText.trim();

        if (!text) throw new Error('请粘贴备份内容');

        if (text.length >= this.restoreMaxChars) {
          throw new Error(
            '内容达到本页容量上限，可能已被截断，请使用运维恢复流程'
          );
        }

        let payload;

        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error('JSON 格式错误，尚未提交恢复');
        }

        if (
          payload === null ||
          typeof payload !== 'object' ||
          Array.isArray(payload)
        ) {
          throw new Error('备份顶层必须是对象，请检查备份格式');
        }

        // 这里只是基本格式校验。
        // 版本、表结构、外键、文件引用由后端验证。
        const confirmed = await this.confirm(
          '最后确认：恢复备份',
          '此操作可能覆盖成员、积分、规则及结算数据。恢复完成后将退出登录。是否继续？'
        );

        if (!confirmed || !valid() || !this.active) return;

        try {
          await post('/restore', payload);
        } catch (error) {
          // 网络错误不能证明服务端未执行。
          throw new Error(
            `恢复未确认：${error.message || '请求失败'}。请先核对服务器数据，不要连续重复恢复。`
          );
        }

        if (!valid()) return;

        this.restoreText = '';
        this.restorePhrase = '';
        this.restoreAcknowledged = false;
        this.showRestore = false;

        // 恢复后不直接沿用旧页面缓存继续管理。
        this.authEpoch += 1;
        this.identityRequestId += 1;
        this.authReady = false;
        this.resetPasswordForm();
        clearAuth();
        this.canWrite = false;
        this.clearAdminState();

        uni.reLaunch({
          url: '/pages/login/login',
        });
        },
        true
      );
    },

    async logout() {
      if (this.locked) return;

      const confirmed = await this.confirm(
        '退出登录',
        this.hasDrafts
          ? '存在未保存内容，退出后将丢弃。确认退出？'
          : '确认退出当前登录？'
      );

      if (!confirmed || this.locked) return;

      this.authEpoch += 1;
      this.requestId += 1;
      this.identityRequestId += 1;

      clearAuth();
      this.canWrite = false;
      this.authReady = false;
      this.resetPasswordForm();
      this.clearAdminState();

      // 退出后仍有公开只读内容可看, 回首页而不是登录页
      uni.switchTab({ url: '/pages/index/index' });
    },

    openLogin() {
      if (this.locked) return;
      uni.navigateTo({
        url: '/pages/login/login',
        fail: () => this.toast('登录页打开失败'),
      });
    },

    openAdminManagement() {
      if (this.locked || !this.authReady || !this.isSuperAdmin) return;

      uni.navigateTo({
        url: '/pages/admin-users/admin-users',
        fail: () => this.toast('管理员管理页面尚未配置'),
      });
    },

    resetPasswordForm() {
      this.passwordForm = {
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      };
      this.passwordPanelOpen = false;
    },

    togglePasswordPanel() {
      if (this.locked) return;

      if (this.passwordPanelOpen) {
        this.closePasswordPanel();
      } else {
        this.passwordPanelOpen = true;
      }
    },

    async closePasswordPanel() {
      if (this.locked) return;

      const hasInput = Object.values(this.passwordForm).some(Boolean);

      if (hasInput) {
        const confirmed = await this.confirm(
          '取消修改密码',
          '关闭后将清空已输入的密码，是否继续？'
        );

        if (!confirmed || this.locked || !this.active) return;
      }

      this.resetPasswordForm();
    },

    async changeMyPassword() {
      await this.operate('password', async (valid) => {
        const { oldPassword, newPassword, confirmPassword } = this.passwordForm;

        // 密码不 trim, 避免改变用户真实输入
        if (!oldPassword) throw new Error('请输入当前密码');
        if (!newPassword) throw new Error('请输入新密码');
        if (newPassword.length < 8) throw new Error('新密码至少 8 位');
        if (newPassword === oldPassword) throw new Error('新密码不能与当前密码相同');
        if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致');

        const hasBusinessDrafts =
          this.settingsDirty || this.editorOpen || Boolean(this.restoreText.trim());

        const confirmed = await this.confirm(
          '确认修改密码',
          hasBusinessDrafts
            ? '当前存在未保存的业务内容。修改密码成功后将退出登录，这些内容会丢失。是否继续？'
            : '修改成功后将退出当前登录，请使用新密码重新登录。是否继续？'
        );

        if (!confirmed || !valid()) return;

        await post('/auth/change-password', {
          old_password: oldPassword,
          new_password: newPassword,
        });

        if (!valid()) return;

        this.resetPasswordForm();

        this.authEpoch += 1;
        this.identityRequestId += 1;
        this.authReady = false;
        this.canWrite = false;

        clearAuth();
        this.clearAdminState();

        uni.reLaunch({ url: '/pages/login/login' });
      });
    },

    /** 身份以服务端 /auth/me 为准: 本地角色缓存可能过期或被吊销 */
    async syncIdentity() {
      if (!this.active || this.authLoading) return;

      const requestId = ++this.identityRequestId;
      const epoch = ++this.authEpoch;

      this.authLoading = true;
      this.authReady = false;
      this.authError = '';

      // 让之前未完成的业务读取失效
      this.requestId += 1;
      this.loading = false;

      try {
        const response = await get('/auth/me');

        if (!this.active || requestId !== this.identityRequestId || epoch !== this.authEpoch) {
          return;
        }

        const user = response && response.user;
        const role = user && user.role ? user.role : response && response.role ? response.role : '';
        // 匿名访客: 后端返回 role=guest 且 user=null(可读公开数据)
        const isGuest = !user || role === 'guest';
        const effectiveRole = isGuest ? 'guest' : role;

        if (!['super_admin', 'admin', 'viewer', 'guest'].includes(effectiveRole)) {
          throw new Error('身份接口返回格式异常');
        }

        const nextUser = {
          id: user ? user.id ?? null : null,
          username: user ? String(user.username || '') : '',
          displayName: user ? String(user.display_name || user.displayName || '') : '',
          role: effectiveRole,
        };

        const previousKey = `${this.currentUser.id}:${this.currentUser.role}`;
        const nextKey = `${nextUser.id}:${nextUser.role}`;

        // 换账号时不能复用上一个账号的页面状态
        if (previousKey !== nextKey) {
          this.clearAdminState();
          this.resetPasswordForm();
          this.tab = 'rewards';
        }

        this.currentUser = nextUser;
        this.canWrite = ['super_admin', 'admin'].includes(effectiveRole);
        this.authReady = true;

        if (!this.canWrite) this.clearAdminState();
      } catch (error) {
        if (this.active && requestId === this.identityRequestId && epoch === this.authEpoch) {
          this.canWrite = false;
          this.authReady = false;
          this.authError = error.message || '身份验证失败，请重试或重新登录';
        }
      } finally {
        if (requestId === this.identityRequestId) this.authLoading = false;
      }

      if (this.active && this.authReady && this.canWrite && !this.ready && !this.locked) {
        await this.load();
      }
    },
  },
};
</script>

<style scoped>
.settings-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24rpx;
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
  background: #f4f6fb;
  color: #263247;
}

/* 身份卡 */
.identity-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 32rpx 26rpx;
  margin-bottom: 24rpx;
  border-radius: 24rpx;
  background: linear-gradient(130deg, #4259d5, #7483ee);
  box-shadow: 0 12rpx 30rpx rgba(73, 91, 202, 0.16);
  color: #fff;
}

.identity-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 84rpx;
  height: 84rpx;
  flex-shrink: 0;
  border-radius: 22rpx;
  background: rgba(255, 255, 255, 0.17);
  font-size: 34rpx;
  font-weight: 700;
}

.identity-content {
  flex: 1;
  min-width: 0;
}

.identity-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
}

.identity-description {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: #e3e8ff;
}

.identity-badge {
  flex-shrink: 0;
  padding: 8rpx 14rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.3);
  border-radius: 999rpx;
  font-size: 21rpx;
}

/* 分类 */
.tabs {
  display: flex;
  gap: 8rpx;
  padding: 8rpx;
  background: #e9edf6;
  border-radius: 16rpx;
}

.tab-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 8rpx;
  min-height: 44px;
  margin: 0;
  padding: 10rpx 4rpx;
  border-radius: 12rpx;
  background: transparent;
  color: #748096;
  font-size: 26rpx;
  line-height: 1.4;
}

.tab-button.active {
  background: #fff;
  color: #5063db;
  font-weight: 700;
  box-shadow: 0 4rpx 12rpx rgba(40, 58, 100, 0.04);
}

.dirty-dot {
  width: 10rpx;
  height: 10rpx;
  flex-shrink: 0;
  border-radius: 50%;
  background: #e9a23b;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 8rpx 4rpx;
}

.toolbar-hint {
  color: #8791a5;
  font-size: 22rpx;
}

.text-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 12rpx;
  background: transparent;
  color: #5266df;
  font-size: 24rpx;
  line-height: 1.4;
}

/* 通用卡片 */
.card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  border-radius: 22rpx;
  background: #fff;
  border: 2rpx solid #edf0f6;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.section-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
}

.section-subtitle {
  display: block;
  margin-top: 10rpx;
  color: #8791a5;
  font-size: 22rpx;
  line-height: 1.6;
}

.description,
.small-description {
  display: block;
  color: #7b879a;
  font-size: 24rpx;
  line-height: 1.8;
}

.small-description {
  margin-top: 12rpx;
  font-size: 22rpx;
}

.tag {
  flex-shrink: 0;
  padding: 8rpx 12rpx;
  border-radius: 9rpx;
  background: #eef1ff;
  color: #596bdb;
  font-size: 21rpx;
}

.tag.neutral {
  background: #f0f3f7;
  color: #7a869a;
}

.warning-tag {
  background: #fff5df;
  color: #a97822;
}

.danger-tag {
  background: #fff0f1;
  color: #cd5c67;
}

.info-box,
.notice {
  padding: 20rpx;
  margin-top: 20rpx;
  border-radius: 12rpx;
  background: #f1f5ff;
  color: #6175a2;
  font-size: 23rpx;
  line-height: 1.7;
}

.notice {
  margin-bottom: 20rpx;
}

.warning {
  background: #fff8e9;
  color: #9b762e;
}

.danger-notice {
  background: #fff1f2;
  color: #bb5260;
}

/* 奖励 */
.reward-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #f0f2f7;
}

.reward-label {
  flex: 1;
  min-width: 0;
}

.reward-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
}

.reward-period {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: #94a0b1;
}

.money-input-box {
  display: flex;
  align-items: center;
  width: 210rpx;
  min-height: 44px;
  flex-shrink: 0;
  padding: 0 18rpx;
  box-sizing: border-box;
  border: 2rpx solid #e3e8f1;
  border-radius: 12rpx;
  background: #fafbfe;
}

.money-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  font-size: 31rpx;
  font-weight: 600;
  text-align: right;
  color: #34446c;
}

.money-unit {
  margin-left: 12rpx;
  color: #9aa4b4;
  font-size: 23rpx;
}

.cycle-box {
  padding: 20rpx;
  margin-top: 22rpx;
  border-radius: 14rpx;
  background: #f7f9fc;
}

.cycle-line {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
  padding: 8rpx 0;
  color: #8691a4;
  font-size: 24rpx;
}

.cycle-value {
  color: #52617d;
  text-align: right;
}

.draft-budget {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 2rpx solid #eef1f7;
}

.draft-label {
  font-size: 25rpx;
  color: #5e6a81;
}

.draft-amount {
  flex-shrink: 0;
  color: #5266df;
  font-size: 37rpx;
  font-weight: 700;
}

.budget-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f1f3f8;
}

.budget-name {
  display: block;
  font-size: 26rpx;
}

.budget-detail {
  display: block;
  margin-top: 8rpx;
  color: #94a0b0;
  font-size: 23rpx;
}

.budget-value {
  font-size: 28rpx;
  font-weight: 600;
}

.budget-summary {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.budget-metric {
  flex: 1;
  min-width: 0;
  padding: 22rpx;
  border-radius: 14rpx;
  background: #f7f9fd;
}

.metric-label {
  display: block;
  color: #8a96a9;
  font-size: 22rpx;
}

.metric-value {
  display: block;
  margin-top: 12rpx;
  color: #465ed2;
  font-size: 32rpx;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.green {
  color: #249878;
}

/* 规则 */
.compact-button,
.status-button,
.edit-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 20rpx;
  border-radius: 12rpx;
  font-size: 24rpx;
  line-height: 1.4;
}

.compact-button,
.edit-button {
  background: #eef1ff;
  color: #5368dd;
}

.input {
  width: 100%;
  height: 48px;
  padding: 0 20rpx;
  box-sizing: border-box;
  border: 2rpx solid #e3e8f1;
  border-radius: 12rpx;
  background: #fafbfe;
  color: #334155;
  font-size: 27rpx;
}

.field-label {
  display: block;
  margin: 22rpx 0 12rpx;
  font-size: 25rpx;
  color: #627087;
}

.editor-card {
  border-color: #cfd7fd;
}

.form-columns {
  display: flex;
  gap: 18rpx;
}

.form-column {
  flex: 1;
  min-width: 0;
}

.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22rpx;
  font-size: 26rpx;
  color: #65738a;
}

.rule-card .section-heading {
  margin-bottom: 22rpx;
}

.rule-disabled {
  background: #fafbfd;
}

.rule-title-group {
  display: flex;
  align-items: center;
  gap: 18rpx;
  flex: 1;
  min-width: 0;
}

.rule-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 70rpx;
  height: 70rpx;
  flex-shrink: 0;
  border-radius: 18rpx;
  color: #5e70d9;
  background: #edf1ff;
  font-size: 28rpx;
  font-weight: 700;
}

.rule-disabled .rule-avatar {
  background: #edf0f5;
  color: #95a0b2;
}

.rule-name-group {
  flex: 1;
  min-width: 0;
}

.rule-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.rule-unit {
  display: block;
  margin-top: 8rpx;
  color: #96a0b1;
  font-size: 22rpx;
}

.status-button {
  flex-shrink: 0;
  background: #edf0f4;
  color: #8a95a7;
}

.status-button.enabled {
  color: #249778;
  background: #e9f7f1;
}

.rule-metrics {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid #eef1f7;
}

.rule-score {
  display: block;
  margin-top: 10rpx;
  font-size: 31rpx;
  font-weight: 600;
  color: #475772;
}

.score-unit {
  margin-left: 6rpx;
  color: #95a0b2;
  font-size: 21rpx;
  font-weight: 400;
}

/* 数据 */
.data-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.data-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: calc((100% - 16rpx) / 2);
  box-sizing: border-box;
  margin: 0;
  padding: 24rpx;
  border-radius: 16rpx;
  background: #f7f9fd;
  text-align: left;
  line-height: 1.5;
}

.data-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 62rpx;
  height: 62rpx;
  border-radius: 16rpx;
  margin-bottom: 16rpx;
  font-size: 25rpx;
  font-weight: 700;
}

.blue-icon {
  background: #e9eeff;
  color: #5a70d8;
}

.green-icon {
  background: #e6f6ee;
  color: #2f9b79;
}

.purple-icon {
  background: #f0eafb;
  color: #9370bd;
}

.data-title {
  display: block;
  color: #48566f;
  font-size: 26rpx;
  font-weight: 600;
}

.data-subtitle {
  display: block;
  margin-top: 8rpx;
  color: #95a0b2;
  font-size: 21rpx;
}

.wide-tile {
  width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 18rpx;
}

.wide-tile .data-icon {
  margin-bottom: 0;
  flex-shrink: 0;
}

.backup-tile-text {
  flex: 1;
  min-width: 0;
}

.tile-arrow {
  color: #a8b0bf;
  font-size: 36rpx;
}

.danger-card {
  border-color: #f4dce0;
}

.danger-text,
.error-text {
  color: #c75b68;
}

.restore-textarea {
  width: 100%;
  height: 260rpx;
  box-sizing: border-box;
  padding: 20rpx;
  border: 2rpx solid #eadde0;
  border-radius: 12rpx;
  background: #fdfafb;
  color: #6e6570;
  font-size: 23rpx;
  line-height: 1.7;
}

.ack-row {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  padding: 24rpx 0 0;
  font-size: 23rpx;
  color: #946a71;
  line-height: 1.7;
}

/* 按钮与底部 */
.button-row {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  box-sizing: border-box;
  margin: 20rpx 0 0;
  padding: 14rpx 20rpx;
  border-radius: 13rpx;
  font-size: 27rpx;
  font-weight: 600;
  line-height: 1.5;
}

.button-row .button {
  flex: 1;
  margin-top: 0;
}

.primary {
  background: #5266df;
  color: #fff;
}

.secondary {
  background: #f0f3f8;
  color: #7c889c;
}

.danger-light {
  background: #fff1f2;
  color: #c8636f;
}

.danger-solid {
  background: #d96570;
  color: #fff;
}

.logout-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 48px;
  box-sizing: border-box;
  margin: 24rpx 0 0;
  padding: 16rpx;
  border: 2rpx solid #e8eaf0;
  border-radius: 16rpx;
  background: #fff;
  color: #ca6974;
  font-size: 28rpx;
  line-height: 1.5;
}

.footer-note {
  display: block;
  margin-top: 26rpx;
  text-align: center;
  color: #a5aebe;
  font-size: 21rpx;
}

.state-card {
  margin-top: 24rpx;
  text-align: center;
  padding: 50rpx 28rpx;
}

.state-title {
  display: block;
  margin-bottom: 18rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.empty {
  padding: 36rpx 20rpx;
  color: #98a3b5;
  font-size: 25rpx;
  text-align: center;
  line-height: 1.7;
}

button::after {
  border: none;
}

button[disabled] {
  opacity: 0.5;
}

/* 特别窄的手机屏幕 */
@media screen and (max-width: 350px) {
  .identity-badge {
    display: none;
  }

  .money-input-box {
    width: 175rpx;
  }

  .draft-budget {
    align-items: flex-start;
    flex-direction: column;
  }

  .form-columns {
    flex-direction: column;
    gap: 0;
  }

  .rule-metrics {
    flex-wrap: wrap;
  }
}

/* ===== 页面整体 ===== */
.settings-page {
  padding: 32rpx 28rpx;
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
  background: linear-gradient(
    160deg,
    #edf3ff 0,
    #f5f7fc 420rpx,
    #f6f8fc 100%
  );
  color: #283650;
}

.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14rpx 4rpx 32rpx;
}

.page-eyebrow {
  display: block;
  margin-bottom: 12rpx;
  color: #8796b5;
  font-size: 18rpx;
  font-weight: 600;
  letter-spacing: 4rpx;
}

.page-title {
  display: block;
  color: #233451;
  font-size: 44rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}

.page-subtitle {
  display: block;
  margin-top: 12rpx;
  color: #8995aa;
  font-size: 22rpx;
  line-height: 1.7;
}

.heading-decoration {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 78rpx;
  height: 78rpx;
  margin-left: 16rpx;
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.65);
  color: #8b9fd7;
  font-size: 42rpx;
}

/* ===== 身份卡 ===== */
.identity-card {
  position: relative;
  overflow: hidden;
  padding: 34rpx 28rpx;
  margin-bottom: 28rpx;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 28rpx;
  background: linear-gradient(120deg, #5279ed, #7268df);
  box-shadow: 0 16rpx 38rpx rgba(75, 98, 194, 0.16);
}

.identity-super {
  background: linear-gradient(120deg, #344e91, #6665ae);
}

.identity-viewer {
  background: linear-gradient(120deg, #538c9f, #6ba5ae);
}

.identity-icon {
  position: relative;
  z-index: 1;
  width: 88rpx;
  height: 88rpx;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.16);
  font-size: 36rpx;
}

.identity-content {
  position: relative;
  z-index: 1;
}

.identity-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
}

.identity-title {
  max-width: 100%;
  font-size: 32rpx;
  overflow-wrap: anywhere;
}

.identity-badge {
  padding: 5rpx 12rpx;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.12);
  font-size: 19rpx;
  line-height: 1.5;
}

.identity-account {
  display: block;
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
  overflow-wrap: anywhere;
}

.identity-description {
  margin-top: 14rpx;
  color: rgba(255, 255, 255, 0.82);
  font-size: 21rpx;
}

.identity-watermark {
  position: absolute;
  right: -18rpx;
  bottom: -32rpx;
  opacity: 0.09;
  font-size: 180rpx;
  transform: rotate(-12deg);
  pointer-events: none;
}

/* ===== 卡片与文字 ===== */
.card {
  padding: 30rpx;
  margin-bottom: 24rpx;
  border: 1px solid #eaf0f8;
  border-radius: 26rpx;
  background: #fff;
  box-shadow: 0 8rpx 28rpx rgba(39, 63, 114, 0.035);
}

.section-title {
  color: #2d3b56;
  font-size: 30rpx;
  font-weight: 700;
}

.section-kicker {
  display: block;
  margin-bottom: 10rpx;
  color: #9aa8c2;
  font-size: 17rpx;
  font-weight: 600;
  letter-spacing: 3rpx;
}

.section-subtitle {
  color: #8b97ac;
  line-height: 1.75;
}

.tag {
  border-radius: 10rpx;
}

/* ===== 账号与安全 ===== */
.account-card {
  padding-bottom: 12rpx;
}

.setting-entry {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 100rpx;
  box-sizing: border-box;
  margin: 0;
  padding: 22rpx 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  line-height: 1.5;
}

.setting-entry + .setting-entry {
  border-top: 1px solid #f0f3f8;
}

.entry-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 66rpx;
  height: 66rpx;
  margin-right: 20rpx;
  border-radius: 20rpx;
  font-size: 26rpx;
  font-weight: 600;
}

.entry-blue {
  background: #edf2ff;
  color: #5b7ae0;
}

.entry-purple {
  background: #f1edff;
  color: #8a6acf;
}

.entry-content {
  flex: 1;
  min-width: 0;
}

.entry-title {
  display: block;
  color: #40506a;
  font-size: 27rpx;
  font-weight: 600;
}

.entry-description {
  display: block;
  margin-top: 7rpx;
  color: #929eb2;
  font-size: 21rpx;
  line-height: 1.65;
}

.entry-label {
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 6rpx 10rpx;
  border-radius: 8rpx;
  background: #f4f0fc;
  color: #9075b8;
  font-size: 18rpx;
}

.entry-arrow {
  flex-shrink: 0;
  margin-left: 16rpx;
  color: #aab4c6;
  font-size: 38rpx;
  font-weight: 400;
}

.account-footnote {
  padding: 14rpx 0 18rpx;
  border-top: 1px solid #f0f3f8;
  color: #96a1b4;
  font-size: 21rpx;
  line-height: 1.8;
}

.password-panel {
  padding: 4rpx 22rpx 24rpx;
  margin: 4rpx 0 18rpx;
  border: 1px solid #e9eef8;
  border-radius: 20rpx;
  background: #f9fbff;
}

/* ===== 分类栏 ===== */
.tabs {
  gap: 10rpx;
  padding: 8rpx;
  margin-bottom: 8rpx;
  border: 1px solid #e6ecf6;
  border-radius: 20rpx;
  background: #eaf0f9;
}

.tab-button {
  border-radius: 15rpx;
  color: #8390a8;
  font-size: 25rpx;
}

.tab-button.active {
  background: #fff;
  color: #5673dc;
  box-shadow: 0 5rpx 16rpx rgba(56, 77, 128, 0.07);
}

.page-toolbar {
  padding: 4rpx 8rpx 10rpx;
}

/* ===== 输入和按钮 ===== */
.input,
.money-input-box {
  border: 1px solid #e5ebf5;
  border-radius: 15rpx;
  background: #f9fbff;
}

.input {
  color: #354767;
}

.money-input {
  color: #496293;
}

.input-wrap:focus-within,
.money-input-box:focus-within {
  border-color: #8ba4f2;
  box-shadow: 0 0 0 5rpx rgba(83, 117, 238, 0.07);
}

.button {
  border-radius: 16rpx;
}

.primary {
  background: linear-gradient(110deg, #567cf0, #7165e1);
  box-shadow: 0 8rpx 18rpx rgba(87, 110, 220, 0.15);
}

.secondary {
  background: #eef2f8;
  color: #74839d;
}

.compact-button,
.edit-button {
  border-radius: 13rpx;
  background: #eef3ff;
  color: #5e79dc;
}

/* ===== 奖励预算 ===== */
.reward-row {
  padding: 25rpx 0;
  border-bottom: 1px solid #f0f3f8;
}

.reward-name {
  color: #43526c;
}

.cycle-box {
  padding: 22rpx;
  border-radius: 18rpx;
  background: #f7f9fd;
}

.draft-budget {
  padding: 24rpx;
  border: none;
  border-radius: 20rpx;
  background: linear-gradient(120deg, #eff4ff, #f5f2ff);
}

.draft-label {
  color: #687ba2;
}

.draft-amount {
  color: #5d72d9;
  font-size: 38rpx;
  overflow-wrap: anywhere;
}

.budget-metric {
  padding: 24rpx;
  border: 1px solid #edf1f8;
  border-radius: 18rpx;
  background: #f8faff;
}

.budget-metric:last-child {
  border-color: #e7f3ee;
  background: #f3faf7;
}

/* ===== 规则卡片 ===== */
.rule-avatar {
  border-radius: 21rpx;
  background: linear-gradient(140deg, #edf3ff, #ecebfc);
}

.rule-disabled {
  background: #fafbfd;
  box-shadow: none;
}

.rule-metrics {
  border-top: 1px solid #eef2f8;
}

.status-button {
  min-height: 36px;
  border-radius: 999rpx;
  font-size: 22rpx;
}

.editor-card {
  border-color: #d5dffb;
  box-shadow: 0 8rpx 28rpx rgba(78, 108, 208, 0.06);
}

/* ===== 数据安全 ===== */
.data-tile {
  padding: 26rpx;
  border: 1px solid #edf1f8;
  border-radius: 20rpx;
  background: #f8faff;
}

.data-icon {
  border-radius: 18rpx;
}

.wide-tile {
  background: linear-gradient(120deg, #f7f5fd, #fafbff);
}

.danger-card {
  border: 1px solid #f1dce1;
  background: linear-gradient(180deg, #fffcfd, #fff);
  box-shadow: none;
}

.danger-light {
  background: #fff0f2;
  color: #c36675;
}

.danger-solid {
  background: linear-gradient(110deg, #d97581, #cb6170);
}

.permission-card {
  border-style: dashed;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: none;
}

/* ===== 底部 ===== */
.logout-button {
  margin-top: 32rpx;
  border: 1px solid #eadfe5;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.85);
  color: #bd7180;
}

.footer-note {
  margin-top: 28rpx;
  color: #a4afc1;
  letter-spacing: 2rpx;
}

button[disabled] {
  opacity: 0.48;
  box-shadow: none;
}

/* H5 大屏保持适当内容宽度 */
@media screen and (min-width: 768px) {
  .settings-page {
    padding-top: 36px;
    padding-left: max(24px, calc((100% - 880px) / 2));
    padding-right: max(24px, calc((100% - 880px) / 2));
  }
}

@media screen and (max-width: 350px) {
  .settings-page {
    padding-left: 22rpx;
    padding-right: 22rpx;
  }

  .heading-decoration,
  .entry-label {
    display: none;
  }

  .identity-name-row .identity-badge {
    display: inline-block;
  }

  .identity-icon {
    width: 74rpx;
    height: 74rpx;
    border-radius: 22rpx;
  }

  .card {
    padding: 24rpx;
  }
}
</style>
