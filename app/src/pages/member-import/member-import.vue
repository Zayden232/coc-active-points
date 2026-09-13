<template>
  <view class="page">
    <!-- 页面头部 -->
    <view class="header">
      <text class="title">批量导入成员</text>
      <text class="subtitle">一次最多导入50人，支持多种格式</text>
    </view>

    <!-- 导入方式切换(两种方式并存, 互不影响)
         注意: cocModeEnabled=false 时整块隐藏, 只保留原来的「名单粘贴」三步流程。
         官方 API 只覆盖全球服(国际版), 国服没有公开 API => 国服部署默认关闭,
         将来要启用只改 data 里的 cocModeEnabled 为 true 重新构建即可。 -->
    <view v-if="cocModeEnabled" class="modes">
      <view class="mode" :class="{ on: mode === 'text' }" @click="switchMode('text')">
        <text class="mode-icon">📋</text>
        <view class="mode-body">
          <text class="mode-title">名单粘贴</text>
          <text class="mode-sub">昵称 / 昵称,#标签 / Excel 复制</text>
        </view>
      </view>
      <view class="mode" :class="{ on: mode === 'coc' }" @click="switchMode('coc')">
        <text class="mode-icon">🎮</text>
        <view class="mode-body">
          <text class="mode-title">游戏标签导入</text>
          <text class="mode-sub">部落同步 / 按玩家标签查</text>
        </view>
      </view>
    </view>

    <!-- ==================== 方式一: 名单粘贴(原有流程) ==================== -->
    <template v-if="showTextMode">
      <!-- 流程步骤指示器 -->
      <view class="steps">
        <view class="step" :class="{ active: step === 1, done: step > 1 }">
          <text class="step-number">1</text>
          <text class="step-label">粘贴名单</text>
        </view>
        <view class="step-line"></view>
        <view class="step" :class="{ active: step === 2, done: step > 2 }">
          <text class="step-number">2</text>
          <text class="step-label">预览解析</text>
        </view>
        <view class="step-line"></view>
        <view class="step" :class="{ active: step === 3 }">
          <text class="step-number">3</text>
          <text class="step-label">确认导入</text>
        </view>
      </view>

      <!-- 第一步：输入名单 -->
      <view v-show="step === 1" class="card">
        <view class="input-section">
          <view class="input-header">
            <text class="label">粘贴成员名单</text>
            <view class="format-tips">
              <text class="tip-trigger" @click="toggleTips">
                格式说明
                <text class="tip-icon">{{ showTips ? '−' : '+' }}</text>
              </text>
            </view>
          </view>

          <!-- 格式说明折叠面板 -->
          <view v-if="showTips" class="format-examples">
            <text class="example-title">✅ 支持的格式：</text>
            <view class="example">
              <text class="example-label">识图格式（推荐）：</text>
              <text class="example-content">名称,大本营,牌子,繁荣度</text>
            </view>
            <view class="example">
              <text class="example-label">基础格式：</text>
              <text class="example-content">昵称</text>
            </view>
            <view class="example">
              <text class="example-label">带标签：</text>
              <text class="example-content">昵称,#游戏标签</text>
            </view>
            <view class="example">
              <text class="example-label">完整格式：</text>
              <text class="example-content">昵称,#游戏标签,备注信息</text>
            </view>
            <view class="example">
              <text class="example-label">Excel复制：</text>
              <text class="example-content">制表符或逗号分隔</text>
            </view>
            <view class="example">
              <text class="example-label">📋 示例：</text>
              <text class="example-content mono">清风霁月,14,绿,63
YEAH,15,绿,63
大力叫兽,14,红,60
泥头车出击
测试1,#ABC123
测试2,#DEF456,新入部落</text>
            </view>
            <text class="example-hint">
              名字已存在时不会重复建人：牌子变了会列进「牌子变化」，大本营/繁荣度变了会列进「资料变化」，
              确认页可以分别勾选要不要写库。
            </text>
          </view>

          <!-- 输入框 -->
          <textarea
            class="input-textarea"
            v-model="text"
            placeholder="每行一个成员，支持：
• 昵称
• 昵称,#游戏标签
• 昵称,#游戏标签,备注
• 从Excel直接粘贴"
            :maxlength="maxInputChars"
            @input="onInputChange"
          />

          <!-- 输入统计 -->
          <view class="input-stats">
            <text class="stat">
              已输入 {{ textLength }} 字符
              <text v-if="lineCount > 0">（{{ lineCount }} 行）</text>
            </text>
            <text class="stat limit" :class="{ warn: textLength > maxInputChars * 0.8 }">
              最多 {{ maxInputChars }} 字符
            </text>
          </view>

          <!-- 同名处理选项 -->
          <view class="option-section">
            <checkbox-group @change="onAllowSame">
              <label class="checkbox-label">
                <checkbox
                  value="allow"
                  :checked="allowSameName"
                  color="#4361ee"
                />
                <text>允许同名但标签不同的成员同时存在</text>
              </label>
            </checkbox-group>
            <text class="option-hint">
              启用后，相同昵称但游戏标签不同会视为不同成员
            </text>
          </view>
        </view>

        <!-- 预览按钮 -->
        <button
          class="btn primary large"
          :disabled="!text.trim() || loading"
          @click="doPreview"
        >
          {{ loading ? '解析中…' : '预览解析结果' }}
        </button>
      </view>

      <!-- 第二步：预览结果
           必须用 v-if: v-show 不会阻止渲染, preview 为 null 时里面 preview.counts / preview.in_tribe_after 会抛
           "Cannot read properties of null" -->
      <view v-if="step === 2 && preview" class="card">
        <view class="preview-header">
          <text class="card-title">预览解析结果</text>
          <button class="btn small secondary" @click="backToInput">
            返回修改
          </button>
        </view>

        <!-- 统计概览 -->
        <view class="summary-stats">
          <view class="stat-card success">
            <text class="stat-value">{{ preview.counts.add }}</text>
            <text class="stat-label">新成员</text>
          </view>
          <view class="stat-card success">
            <text class="stat-value">{{ preview.counts.restore }}</text>
            <text class="stat-label">恢复成员</text>
          </view>
          <view class="stat-card neutral">
            <text class="stat-value">{{ preview.counts.exists }}</text>
            <text class="stat-label">已存在</text>
          </view>
          <view class="stat-card warning">
            <text class="stat-value">{{ preview.counts.conflict }}</text>
            <text class="stat-label">同名冲突</text>
          </view>
          <view class="stat-card error">
            <text class="stat-value">{{ preview.errors.length }}</text>
            <text class="stat-label">错误 / 重复</text>
          </view>
        </view>

        <!-- 重名成员的更新: 牌子变化 / 资料变化(默认勾选, 在确认页可取消) -->
        <view
          v-if="preview.counts.status_change || preview.counts.profile_change"
          class="update-summary"
        >
          <view v-if="preview.counts.status_change" class="update-item">
            <text class="update-title">🚩 牌子变化 {{ preview.counts.status_change }} 人</text>
            <text class="update-detail">
              绿 → 红 {{ preview.status_change_detail.to_red }} 人 ·
              红 → 绿 {{ preview.status_change_detail.to_green }} 人
            </text>
          </view>
          <view v-if="preview.counts.profile_change" class="update-item">
            <text class="update-title">📈 资料变化 {{ preview.counts.profile_change }} 人</text>
            <text class="update-detail">大本营等级 / 繁荣度与库内不一致</text>
          </view>
        </view>

        <!-- 总人数提醒 -->
        <view class="total-warning" :class="{ error: preview.in_tribe_after > 50 }">
          <text class="warning-icon">📊</text>
          <text>导入后部落人数：{{ preview.in_tribe_after }} / 50</text>
        </view>

        <!-- 服务器提醒 -->
        <view v-if="preview.warning" class="warning-box">
          <text class="warning-icon">⚠️</text>
          <text>{{ preview.warning }}</text>
        </view>

        <!-- 错误列表 -->
        <view v-if="preview.errors.length" class="error-section">
          <text class="section-title">❌ 格式错误 / 重复（{{ preview.errors.length }} 项）</text>
          <view class="error-list">
            <!-- 后端错误文案自带「第 N 行: 原因」, 这里原样展示, 不再二次拼行号 -->
            <text
              v-for="(error, index) in preview.errors"
              :key="index"
              class="error-item"
            >
              {{ error }}
            </text>
          </view>
        </view>

        <!-- 新成员列表 -->
        <view v-if="preview.add.length" class="member-section">
          <text class="section-title">
            ✅ 将新增 {{ preview.add.length }} 人
            <text v-if="preview.add.length > visibleNewCount" class="show-more" @click="toggleNewList">
              {{ showAllNew ? '收起' : `展开全部 ${preview.add.length} 人` }}
            </text>
          </text>
          <view class="member-grid">
            <view
              v-for="(member, index) in displayedNewMembers"
              :key="'new-' + index"
              class="member-card"
            >
              <text class="member-name">{{ member.nickname }}</text>
              <text v-if="statText(member)" class="member-tag">{{ statText(member) }}</text>
              <text v-else-if="member.tag" class="member-tag">{{ tagText(member) }}</text>
              <text v-if="member.note" class="member-remark">{{ member.note }}</text>
            </view>
          </view>
        </view>

        <!-- 恢复成员列表 -->
        <view v-if="preview.restore.length" class="member-section">
          <text class="section-title">🔄 将恢复 {{ preview.restore.length }} 人为在部落</text>
          <view class="member-grid">
            <view
              v-for="(member, index) in preview.restore"
              :key="'restore-' + index"
              class="member-card"
            >
              <text class="member-name">{{ member.nickname }}</text>
              <text v-if="statText(member)" class="member-tag">{{ statText(member) }}</text>
              <text v-else-if="member.tag" class="member-tag">{{ tagText(member) }}</text>
            </view>
          </view>
        </view>

        <!-- 牌子变化列表 -->
        <view v-if="preview.status_change.length" class="member-section">
          <text class="section-title">
            🚩 牌子变化 {{ preview.status_change.length }} 人（默认勾选，确认页可取消）
          </text>
          <view class="member-grid">
            <view
              v-for="(member, index) in preview.status_change"
              :key="'st-' + index"
              class="member-card"
            >
              <text class="member-name">{{ member.nickname }}</text>
              <text class="member-tag">{{ member.reason }}</text>
              <text v-if="statText(member)" class="member-remark">{{ statText(member) }}</text>
            </view>
          </view>
        </view>

        <!-- 资料变化列表 -->
        <view v-if="preview.profile_change.length" class="member-section">
          <text class="section-title">
            📈 资料变化 {{ preview.profile_change.length }} 人（默认勾选，确认页可取消）
          </text>
          <view class="member-grid">
            <view
              v-for="(member, index) in preview.profile_change"
              :key="'pf-' + index"
              class="member-card"
            >
              <text class="member-name">{{ member.nickname }}</text>
              <text class="member-tag">{{ member.reason }}</text>
            </view>
          </view>
        </view>

        <!-- 冲突成员列表 -->
        <view v-if="preview.conflict.length" class="member-section">
          <text class="section-title">
            ⚠️ 同名冲突（{{ preview.conflict.length }} 人，本次跳过）
            <text class="hint">如需导入，请返回启用"允许同名但标签不同"选项</text>
          </text>
          <view class="member-grid">
            <view
              v-for="(member, index) in preview.conflict"
              :key="'conflict-' + index"
              class="member-card conflict"
            >
              <text class="member-name">{{ member.nickname }}</text>
              <text v-if="member.tag" class="member-tag">{{ tagText(member) }}</text>
            </view>
          </view>
        </view>

        <!-- 操作按钮 -->
        <view class="button-group">
          <button class="btn secondary" @click="backToInput">
            返回修改
          </button>
          <button
            class="btn primary"
            :disabled="!canProceedToConfirm || importing"
            @click="proceedToConfirm"
          >
            继续导入
          </button>
        </view>
      </view>

      <!-- 第三步：确认导入(同上, 必须 v-if, 否则 preview 为 null 时渲染期报错) -->
      <view v-if="step === 3 && preview" class="card">
        <view class="confirm-header">
          <text class="card-title">确认导入</text>
        </view>

        <!-- 导入摘要 -->
        <view class="confirm-summary">
          <view class="summary-item">
            <text class="summary-label">新增成员</text>
            <text class="summary-value">{{ preview.counts.add }} 人</text>
          </view>
          <view class="summary-item">
            <text class="summary-label">恢复成员</text>
            <text class="summary-value">{{ preview.counts.restore }} 人</text>
          </view>
          <view class="summary-item">
            <text class="summary-label">牌子变化</text>
            <text class="summary-value">{{ preview.counts.status_change }} 人</text>
          </view>
          <view class="summary-item">
            <text class="summary-label">资料变化</text>
            <text class="summary-value">{{ preview.counts.profile_change }} 人</text>
          </view>
          <view class="summary-item highlight">
            <text class="summary-label">导入后部落人数</text>
            <text class="summary-value">{{ preview.in_tribe_after }} / 50</text>
          </view>
        </view>

        <!-- 重名成员的更新: 分别勾选要不要写库(默认勾选) -->
        <view
          v-if="preview.counts.status_change || preview.counts.profile_change"
          class="apply-options"
        >
          <text class="apply-title">重名成员的更新</text>

          <label
            v-if="preview.counts.status_change"
            class="apply-option"
          >
            <checkbox
              :checked="applyStatusChange"
              color="#4361ee"
              @click="applyStatusChange = !applyStatusChange"
            />
            <text class="apply-label">
              修改牌子 {{ preview.counts.status_change }} 人
              <text class="apply-detail">
                （绿→红 {{ preview.status_change_detail.to_red }} · 红→绿 {{ preview.status_change_detail.to_green }}）
              </text>
            </text>
          </label>

          <label
            v-if="preview.counts.profile_change"
            class="apply-option"
          >
            <checkbox
              :checked="applyProfileChange"
              color="#4361ee"
              @click="applyProfileChange = !applyProfileChange"
            />
            <text class="apply-label">
              更新大本营 / 繁荣度 {{ preview.counts.profile_change }} 人
            </text>
          </label>

          <text class="apply-hint">
            取消勾选就不会写库；牌子变化会写审计日志。
          </text>
        </view>

        <!-- 超出人数提醒(软提醒: 历史数据可能已超 50, 服务端同样只提醒不硬拦) -->
        <view v-if="preview.in_tribe_after > 50" class="warning-box error">
          <text class="warning-icon">⚠️</text>
          <text>导入后在部落人数将达到 {{ preview.in_tribe_after }} 人，已超过游戏上限 50 人。确认后仍可导入。</text>
        </view>

        <!-- 操作按钮 -->
        <view class="button-group">
          <button class="btn secondary" @click="step = 2">
            返回预览
          </button>
          <button
            class="btn primary"
            :disabled="!canImportFinal || importing"
            @click="doImport"
          >
            {{ importing ? '导入中…' : '确认导入' }}
          </button>
        </view>
      </view>
    </template>

    <!-- ==================== 方式二: 游戏标签导入(官方 API) ==================== -->
    <template v-else>
      <view class="card">
        <!-- 子方式切换 -->
        <view class="subtabs">
          <view class="subtab" :class="{ on: cocTab === 'clan' }" @click="switchCocTab('clan')">
            <text class="subtab-title">部落同步</text>
            <text class="subtab-sub">整部落一键比对</text>
          </view>
          <view class="subtab" :class="{ on: cocTab === 'tags' }" @click="switchCocTab('tags')">
            <text class="subtab-title">按标签导入</text>
            <text class="subtab-sub">粘贴 #标签 逐个查</text>
          </view>
        </view>

        <view v-if="coc.configured === false" class="warning-box error">
          <text class="warning-icon">⚠️</text>
          <text>服务器尚未配置 COC_API_TOKEN，暂时读不到游戏数据（配置后重启服务即可）。</text>
        </view>

        <!-- 部落标签配置 -->
        <view class="field">
          <text class="label">部落标签</text>
          <view class="field-row">
            <input
              class="input"
              v-model="clanTagInput"
              placeholder="#2G9JCRQ9Y"
              :disabled="tagSaving"
            />
            <button
              class="btn small secondary"
              :disabled="tagSaving || !clanTagInput.trim()"
              @click="saveClanTag"
            >
              {{ tagSaving ? '保存中…' : '保存' }}
            </button>
          </view>
          <text class="option-hint">
            游戏内：部落 → 设置 → 复制部落标签。
            <text v-if="coc.clan_tag">当前生效：{{ coc.clan_tag }}</text>
            <text v-else>尚未保存部落标签，保存后才能拉取整部落名单。</text>
          </text>
        </view>

        <!-- A. 部落同步 -->
        <template v-if="cocTab === 'clan'">
          <view class="button-group">
            <button
              class="btn primary"
              :disabled="cocLoading || !coc.clan_tag || coc.configured === false"
              @click="loadDiff"
            >
              {{ cocLoading ? '读取中…' : (diff ? '重新读取游戏数据' : '读取游戏数据') }}
            </button>
          </view>
          <text class="option-hint">
            只读比对，不会改动任何数据。为了拿到最新的战意，每次都会重新向官方拉取（约需几秒）。
          </text>

          <view v-if="diff" class="diff-body">
            <!-- 统计概览 -->
            <view class="summary-stats">
              <view class="stat-card neutral">
                <text class="stat-value">{{ diff.counts.api_members }}</text>
                <text class="stat-label">官方成员</text>
              </view>
              <view class="stat-card success">
                <text class="stat-value">{{ diff.counts.new_members }}</text>
                <text class="stat-label">新成员</text>
              </view>
              <view class="stat-card warning">
                <text class="stat-value">{{ diff.counts.tag_fixes }}</text>
                <text class="stat-label">标签待补</text>
              </view>
              <view class="stat-card warning">
                <text class="stat-value">{{ diff.counts.status_changes }}</text>
                <text class="stat-label">状态变化</text>
              </view>
              <view class="stat-card error">
                <text class="stat-value">{{ diff.counts.leaves }}</text>
                <text class="stat-label">离开建议</text>
              </view>
            </view>

            <view class="total-warning">
              <text class="warning-icon">🏰</text>
              <text>{{ diff.clan.name }}（{{ diff.clan.tag }}）· 等级 {{ diff.clan.level }} · 本地在部落 {{ coc.local_in_tribe }} 人</text>
            </view>

            <view v-if="diff.war && diff.war.state === 'inWar'" class="total-warning">
              <text class="warning-icon">⚔️</text>
              <text>部落战进行中（{{ diff.war.teamSize }} 人）：{{ diff.war.members.length }} 人已出手</text>
            </view>

            <view v-if="diff.truncated" class="warning-box">
              <text class="warning-icon">⚠️</text>
              <text>官方成员超过 {{ coc.max_members_per_run || 60 }} 人，本次只比对了前 {{ coc.max_members_per_run || 60 }} 人。</text>
            </view>

            <!-- 无差异 -->
            <view v-if="!picks.length" class="empty">
              <text>✅ 本地记录与游戏内完全一致，无需同步。</text>
            </view>

            <!-- 差异勾选列表 -->
            <view v-for="g in pickGroups" :key="g.key" class="member-section">
              <view class="section-head">
                <text class="section-title">{{ g.title }}（{{ g.items.length }}）</text>
                <view class="bulk">
                  <text class="show-more" @click="selectGroup(g.key, true)">全选</text>
                  <text class="show-more" @click="selectGroup(g.key, false)">全不选</text>
                </view>
              </view>
              <text v-if="g.hint" class="hint">{{ g.hint }}</text>
              <view class="pick-list">
                <view
                  v-for="c in g.items"
                  :key="c.key"
                  class="pick"
                  :class="{ on: c.checked }"
                  @click="togglePick(c)"
                >
                  <view class="tick" :class="{ on: c.checked }">
                    <text v-if="c.checked" class="tick-mark">✓</text>
                  </view>
                  <view class="pick-body">
                    <view class="pick-line">
                      <text class="pick-title">{{ c.title }}</text>
                      <text v-if="c.tag" class="member-tag">{{ c.tag }}</text>
                    </view>
                    <text class="pick-sub">{{ c.sub }}</text>
                  </view>
                </view>
              </view>
            </view>

            <!-- 应用按钮 -->
            <view v-if="picks.length" class="button-group">
              <button
                class="btn secondary"
                :disabled="applying || !pickedCount"
                @click="applyPicked"
              >
                应用勾选项（{{ pickedCount }}）
              </button>
              <button
                class="btn primary"
                :disabled="applying || !autoAddCount"
                @click="applyAutoAdd"
              >
                {{ applying ? '处理中…' : `导入新增成员（${autoAddCount}）` }}
              </button>
            </view>
            <text v-if="picks.length" class="option-hint">
              「导入新增成员」只自动新增游戏里的新面孔；绿牌/红牌/离开等状态变更需要你勾选后点「应用勾选项」。
            </text>
          </view>

          <view v-else class="empty">
            <text>点「读取游戏数据」拉取官方名单，与本地成员比对后给出建议动作。</text>
          </view>
        </template>

        <!-- B. 按玩家标签导入 -->
        <template v-else>
          <textarea
            class="input-textarea lookup-textarea"
            v-model="lookupText"
            placeholder="粘贴游戏内复制的玩家标签，一行一个，例如：
#2G9JCRQ9Y
#P0LYQ9YC
也支持逗号 / 空格分隔"
            :maxlength="2000"
          />
          <view class="input-stats">
            <text class="stat">每行一个标签，最多 {{ coc.max_lookup_tags || 30 }} 个</text>
          </view>
          <view class="button-group">
            <button
              class="btn primary"
              :disabled="lookupLoading || !lookupText.trim() || coc.configured === false"
              @click="searchTags"
            >
              {{ lookupLoading ? '查询中…' : '查询标签' }}
            </button>
          </view>
          <text class="option-hint">
            查的是官方玩家资料（昵称 / 大本 / 战意），不在本部落的玩家也能查到；本地已有该标签时改状态、否则新增。
          </text>

          <view v-if="lookup" class="diff-body">
            <view class="summary-stats">
              <view class="stat-card neutral">
                <text class="stat-value">{{ lookup.counts.ok }}</text>
                <text class="stat-label">查到玩家</text>
              </view>
              <view class="stat-card success">
                <text class="stat-value">{{ lookup.counts.will_add }}</text>
                <text class="stat-label">可新增</text>
              </view>
              <view class="stat-card warning">
                <text class="stat-value">{{ lookup.counts.will_update }}</text>
                <text class="stat-label">可改状态</text>
              </view>
              <view class="stat-card neutral">
                <text class="stat-value">{{ lookup.counts.in_clan }}</text>
                <text class="stat-label">在部落</text>
              </view>
              <view class="stat-card error">
                <text class="stat-value">{{ lookup.counts.failed }}</text>
                <text class="stat-label">查询失败</text>
              </view>
            </view>

            <view v-if="lookup.invalid && lookup.invalid.length" class="warning-box">
              <text class="warning-icon">⚠️</text>
              <text>无法识别的内容：{{ lookup.invalid.join('、') }}</text>
            </view>

            <view class="member-section">
              <view class="section-head">
                <text class="section-title">查询结果（{{ lookup.items.length }}）</text>
                <view class="bulk">
                  <text class="show-more" @click="selectAllLookup(true)">全选可导入</text>
                  <text class="show-more" @click="selectAllLookup(false)">全不选</text>
                </view>
              </view>
              <view class="pick-list">
                <view
                  v-for="c in lookupPicks"
                  :key="c.key"
                  class="pick"
                  :class="{ on: c.checked, disabled: !c.action }"
                  @click="c.action && toggleLookupPick(c)"
                >
                  <view class="tick" :class="{ on: c.checked }">
                    <text v-if="c.checked" class="tick-mark">✓</text>
                  </view>
                  <view class="pick-body">
                    <view class="pick-line">
                      <text class="pick-title">{{ c.title }}</text>
                      <text class="member-tag">{{ c.tag }}</text>
                    </view>
                    <text class="pick-sub">{{ c.sub }}</text>
                  </view>
                </view>
              </view>
            </view>

            <view class="button-group">
              <button
                class="btn primary"
                :disabled="applying || !lookupPickedCount"
                @click="applyLookup"
              >
                {{ applying ? '处理中…' : `导入勾选成员（${lookupPickedCount}）` }}
              </button>
            </view>
          </view>
        </template>

        <!-- 应用结果 -->
        <view v-if="applyResult" class="result-box">
          <text class="section-title">最近一次同步结果</text>
          <text class="result-line">
            成功 {{ applyResult.applied_count }} · 跳过 {{ applyResult.skipped_count }} · 失败 {{ applyResult.failed_count }}
            <text class="hint">（批次 {{ applyResult.batch_id }}）</text>
          </text>
          <view v-for="(a, i) in applyResult.applied" :key="'ap' + i" class="result-item ok">
            <text>✓ {{ actionLabel(a) }}</text>
          </view>
          <view v-for="(s, i) in applyResult.skipped" :key="'sk' + i" class="result-item skip">
            <text>• {{ s.nickname || s.member_id }} 已跳过：{{ s.reason }}</text>
          </view>
          <view v-for="(f, i) in applyResult.failed" :key="'fl' + i" class="result-item err">
            <text>✗ {{ f.nickname || f.member_id }} 失败：{{ f.reason }}</text>
          </view>
          <text v-if="applyResult.warning" class="result-line warn">⚠️ {{ applyResult.warning }}</text>
        </view>
      </view>
    </template>
  </view>
</template>

<script>
import { get, post, put } from '@/utils/api';
import { ensureAdminPage } from '@/utils/permissions';
import { navTo } from '@/utils/navigation';
import { setBrowserTitle } from '@/utils/h5';

// 本页依赖的后端契约(服务端会二次校验, 前端分类只作展示):
//   POST /api/members/batch/preview -> {
//     parsed, errors:[ "第 N 行: 原因" ],                       // 已含行号, 前端原样展示
//     add:[ {line,nickname,tag,note} ], restore:[ +member_id ], // tag 已由服务端补 '#' 并大写
//     exists:[ ... ], conflict:[ ... ],
//     counts:{ add, restore, exists, conflict, invalid },
//     in_tribe_before, in_tribe_after, warning
//   }
//   POST /api/members/batch -> { added, restored, skipped_exists, conflict, invalid, failed[], in_tribe_after, warning }
// 分类口径(服务端): 标签优先去重 -> 昵称; 离开成员走"恢复"; 同名默认 conflict(除非 allow_same_name);
// 粘贴内容内重复判 invalid。50 人是游戏上限, 服务端只给 warning 不硬拦。
// 幂等性: 同一份名单重复提交不会重复建人(标签命中 exists / 同名命中 conflict 被跳过)。
//
// 游戏标签导入(官方 API, 全部只读, 写库必须显式调用 apply):
//   GET  /api/coc/status  -> { configured, clan_tag, local_in_tribe, max_members_per_run, max_lookup_tags }
//   POST /api/coc/preview -> { clan, members[ {api, war_preference, local_*, actions[]} ], leaves[], counts, war }
//   POST /api/coc/lookup  -> { items[ {tag,name,town_hall,war_preference,in_clan,local,note,action} ], counts, invalid }
//   POST /api/coc/apply   -> { applied_count, skipped_count, failed_count, applied[], skipped[], failed[], warning }
//                            body { actions, batch_id, auto_add } —— auto_add=true 时服务端只自动"新增成员",
//                            状态变更必须由前端显式放进 actions(产品决定: 状态变更永远人工确认)。
// 部落标签存在 settings.coc_clan_tag(走设置白名单, PUT /api/settings 保存)。

const STATUS_TEXT = { 0: '绿牌', 1: '红牌', 2: '离开' };

export default {
  data() {
    return {
      // —— 方式一: 名单粘贴 ——
      text: '',
      allowSameName: false,
      preview: null,
      loading: false,
      importing: false,
      step: 1, // 1:输入, 2:预览, 3:确认
      showTips: false,
      showAllNew: false,
      visibleNewCount: 10,
      maxInputChars: 50000, // 50k字符足够
      // 识图导入的两类"更新": 默认勾选(数据是你自己识别确认过的), 但要到确认页才写库
      applyStatusChange: true,
      applyProfileChange: true,

      // —— 方式切换 ——
      mode: 'text', // text: 名单粘贴 / coc: 游戏标签导入
      cocModeEnabled: false, // 官方 API 只覆盖全球服; 国服部署保持 false(隐藏入口), 要启用改成 true 重新构建
      cocTab: 'clan', // clan: 部落同步 / tags: 按玩家标签

      // —— 方式二: 游戏标签导入 ——
      coc: { configured: null, clan_tag: '', local_in_tribe: 0, max_members_per_run: 60, max_lookup_tags: 30 },
      clanTagInput: '',
      tagSaving: false,
      cocLoading: false,
      diff: null,
      picks: [],
      lookupText: '',
      lookupLoading: false,
      lookup: null,
      lookupPicks: [],
      applying: false,
      applyResult: null,
    };
  },

  computed: {
    // 官方同步入口默认关闭时, 页面等同旧版(只有名单粘贴)
    showTextMode() {
      return !this.cocModeEnabled || this.mode === 'text';
    },

    // 输入统计
    textLength() {
      return this.text.length;
    },

    lineCount() {
      return this.text.split('\n').filter(line => line.trim()).length;
    },

    // 是否可以进入预览
    canPreview() {
      return this.text.trim().length > 0;
    },

    // 是否可以进入确认步骤(新增/恢复/牌子变化/资料变化 任一有内容都算)
    canProceedToConfirm() {
      if (!this.preview) return false;
      return this.previewTotalChanges > 0;
    },

    // 本次预览里一共有多少条"会写库"的东西
    previewTotalChanges() {
      if (!this.preview) return 0;
      const c = this.preview.counts || {};
      return (
        Number(c.add || 0) +
        Number(c.restore || 0) +
        Number(c.status_change || 0) +
        Number(c.profile_change || 0)
      );
    },

    // 按当前勾选, 实际会写库的条数(取消勾选后按钮会禁用)
    effectiveChanges() {
      if (!this.preview) return 0;
      const c = this.preview.counts || {};
      return (
        Number(c.add || 0) +
        Number(c.restore || 0) +
        (this.applyStatusChange ? Number(c.status_change || 0) : 0) +
        (this.applyProfileChange ? Number(c.profile_change || 0) : 0)
      );
    },

    // 是否可以最终导入(50 人是软提醒: 服务端不硬拦, 这里也不拦; 超出时在 doImport 里再确认一次)
    canImportFinal() {
      if (!this.preview) return false;
      return this.effectiveChanges > 0;
    },

    // 显示的新成员列表
    displayedNewMembers() {
      if (!this.preview) return [];
      return this.showAllNew ?
        this.preview.add :
        this.preview.add.slice(0, this.visibleNewCount);
    },

    // 差异勾选列表按类型分组(只渲染有内容的组)
    pickGroups() {
      const titles = {
        add: '✅ 新增成员',
        tag: '🏷️ 补/改游戏标签',
        status: '🔁 状态变化',
        leave: '🚪 建议记为离开',
      };
      const hints = {
        add: '已默认勾选：「导入新增成员」会自动新增；也可以取消勾选后单独应用。',
        tag: '不会改变成员状态，只是把游戏标签写到本地（按昵称匹配的请先确认是不是同一人）。',
        status: '不会自动应用，请确认后勾选再点「应用勾选项」。',
        leave: '不会自动应用；记为离开只改状态，历史积分与记录都保留。',
      };
      const out = [];
      for (const key of ['add', 'tag', 'status', 'leave']) {
        const items = this.picks.filter((p) => p.group === key);
        if (items.length) out.push({ key, title: titles[key], hint: hints[key], items });
      }
      return out;
    },

    pickedCount() {
      return this.picks.filter((p) => p.checked).length;
    },

    pickedActions() {
      return this.picks.filter((p) => p.checked).map((p) => p.action);
    },

    // 服务端自动新增的人数(预览里的新增条数)
    autoAddCount() {
      return this.diff && this.diff.counts ? this.diff.counts.new_members : 0;
    },

    lookupPickedCount() {
      return this.lookupPicks.filter((p) => p.checked).length;
    },
  },

  onLoad() {
    if (!ensureAdminPage()) return;
  },

  onShow() {
    setBrowserTitle();
    if (this.mode === 'coc' && this.coc.configured === null) this.loadCocStatus();
  },

  methods: {
    // 切换格式说明
    toggleTips() {
      this.showTips = !this.showTips;
    },

    // 输入变化时重置预览
    onInputChange() {
      this.preview = null;
      this.step = 1;
    },

    // 同名处理选项变化
    onAllowSame(e) {
      this.allowSameName = e.detail.value.includes('allow');
      this.preview = null;
    },

    // 切换新成员展开状态
    toggleNewList() {
      this.showAllNew = !this.showAllNew;
    },

    // 标签展示: 服务端 normalizeTag 已补 '#' 并大写, 这里只做兜底
    tagText(member) {
      const tag = String((member && member.tag) || '').trim();
      if (!tag) return '';
      return tag.startsWith('#') ? tag : '#' + tag;
    },

    /** 识图数据的次行: 「大本营 14 · 繁荣 63 · 绿牌」 */
    statText(member) {
      if (!member) return '';
      const parts = [];
      if (member.town_hall != null && member.town_hall !== '') parts.push(`大本营 ${member.town_hall}`);
      if (member.prosperity != null && member.prosperity !== '') parts.push(`繁荣 ${member.prosperity}`);
      if (member.status !== undefined && member.status !== null) {
        parts.push(STATUS_TEXT[Number(member.status)] || '');
      }
      return parts.filter(Boolean).join(' · ');
    },

    // 返回输入步骤
    backToInput() {
      this.step = 1;
    },

    // 进入确认步骤
    proceedToConfirm() {
      this.step = 3;
    },

    // 执行预览
    async doPreview() {
      if (!this.canPreview || this.loading) return;

      this.loading = true;
      try {
        const preview = await post('/members/batch/preview', {
          text: this.text,
          allow_same_name: this.allowSameName
        });
        this.preview = preview;
        this.showAllNew = false;
        // 每次预览都回到"默认勾选"(识图数据是你自己确认过的; 取消勾选就不会写库)
        this.applyStatusChange = true;
        this.applyProfileChange = true;
        this.step = 2;
      } catch (e) {
        uni.showToast({
          title: e.message || '解析失败',
          icon: 'none'
        });
      } finally {
        this.loading = false;
      }
    },

    // 确认弹窗(超出 50 人时用)
    confirm(title, content) {
      return new Promise((resolve) => {
        uni.showModal({
          title,
          content,
          success: (r) => resolve(Boolean(r.confirm)),
          fail: () => resolve(false)
        });
      });
    },

    // 返回成员页(直接打开本页时没有上一页, 兜底用 switchTab)
    goBack() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      if (pages && pages.length > 1) uni.navigateBack();
      else navTo('/pages/members/members');
    },

    // 执行导入
    async doImport() {
      if (!this.canImportFinal || this.importing) return;

      // 50 人是游戏上限: 服务端只给 warning 不硬拦, 这里也不硬拦, 但超出时再确认一次
      if (this.preview.in_tribe_after > 50) {
        const go = await this.confirm(
          '超过 50 人上限',
          `导入后在部落人数将达到 ${this.preview.in_tribe_after} 人，已超过游戏上限 50 人。确认继续导入？`
        );
        if (!go || this.importing) return;
      }

      this.importing = true;
      try {
        const res = await post('/members/batch', {
          text: this.text,
          allow_same_name: this.allowSameName,
          apply: {
            status_change: this.applyStatusChange,
            profile_change: this.applyProfileChange
          }
        });

        const skipped = (res.skipped_exists || 0) + (res.conflict || 0) + (res.invalid || 0);
        const msg = `新增 ${res.added} · 恢复 ${res.restored}` +
                   (res.status_changed ? ` · 改牌子 ${res.status_changed}` : '') +
                   (res.profile_changed ? ` · 改资料 ${res.profile_changed}` : '') +
                   (skipped ? ` · 跳过 ${skipped}` : '') +
                   (res.failed && res.failed.length ? ` · 失败 ${res.failed.length}` : '');

        uni.showToast({
          title: msg,
          icon: 'none',
          duration: 3000
        });

        if (res.warning) {
          setTimeout(() => {
            uni.showToast({
              title: res.warning,
              icon: 'none',
              duration: 3500
            });
          }, 3100);
        }

        // 重置状态
        this.text = '';
        this.preview = null;
        this.step = 1;
        this.showAllNew = false;

        // 导入成功后返回成员页(该页 onShow 会重新拉列表)
        setTimeout(() => this.goBack(), 900);

      } catch (e) {
        uni.showToast({
          title: e.message || '导入失败',
          icon: 'none'
        });
      } finally {
        this.importing = false;
      }
    },

    // ==================== 以下: 游戏标签导入 ====================

    switchMode(mode) {
      this.mode = mode;
      if (mode === 'coc' && this.coc.configured === null) this.loadCocStatus();
    },

    switchCocTab(tab) {
      this.cocTab = tab;
    },

    statusText(status) {
      return STATUS_TEXT[Number(status)] || '未知';
    },

    // 读取同步配置(是否需要保存部落标签)
    async loadCocStatus() {
      try {
        const st = await get('/coc/status');
        this.coc = st;
        if (st.clan_tag) this.clanTagInput = st.clan_tag;
      } catch (e) {
        this.coc = { ...this.coc, configured: false };
        uni.showToast({ title: e.message || '读取同步配置失败', icon: 'none' });
      }
    },

    // 保存部落标签(走设置白名单, 需要管理员)
    async saveClanTag() {
      if (this.tagSaving) return;
      const body = String(this.clanTagInput || '').trim().replace(/^#+/, '').toUpperCase();
      const tag = '#' + body;
      if (!/^#[0-9A-Z]{3,12}$/.test(tag)) {
        uni.showToast({ title: '部落标签格式不对，例如 #2G9JCRQ9Y', icon: 'none' });
        return;
      }
      this.tagSaving = true;
      try {
        const settings = await put('/settings', { coc_clan_tag: tag });
        this.coc = { ...this.coc, clan_tag: (settings && settings.coc_clan_tag) || tag };
        this.clanTagInput = this.coc.clan_tag;
        this.diff = null;
        this.picks = [];
        uni.showToast({ title: '部落标签已保存', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none' });
      } finally {
        this.tagSaving = false;
      }
    },

    // 差异显示文案
    diffSub(action, row) {
      const api = (row && row.api) || {};
      const th = api.town_hall ? `大本 ${api.town_hall}` : '';
      const pref = row && row.war_preference ? `游戏内 ${row.war_preference}` : '';
      const tail = [th, pref].filter(Boolean).join(' · ');
      if (action.type === 'add') return `新面孔 → ${this.statusText(action.status)}${tail ? ' · ' + tail : ''}`;
      if (action.type === 'tag') return `本地标签 ${row.local_tag || '（空）'} → ${action.tag}`;
      if (action.type === 'status') return `本地 ${this.statusText(action.from)} → 游戏内 ${this.statusText(action.to)}`;
      if (action.type === 'rejoin') return '本地记为离开，但仍在部落 → 回到部落';
      if (action.type === 'leave') return '官方名单里已没有此人 → 记为离开';
      return action.reason || '';
    },

    // 把差异报告铺平成勾选项(只有"新增"默认勾选)
    buildPicks(diff) {
      const list = [];
      const rows = (diff && diff.members) || [];
      const index = new Map(rows.map((r) => [r.api && r.api.tag, r]));
      for (const row of rows) {
        for (const [i, action] of (row.actions || []).entries()) {
          const group = action.type === 'rejoin' ? 'status' : action.type;
          list.push({
            key: `${group}-${row.api && row.api.tag ? row.api.tag : row.local_id}-${i}`,
            group,
            title: action.nickname || (row.api && row.api.name) || `#${row.local_id}`,
            tag: action.tag || (row.api && row.api.tag) || '',
            sub: this.diffSub(action, row),
            action,
            checked: action.type === 'add', // 产品决定: 只自动新增, 状态变更必须人工勾选
          });
        }
      }
      for (const [i, l] of ((diff && diff.leaves) || []).entries()) {
        list.push({
          key: `leave-${l.member_id}-${i}`,
          group: 'leave',
          title: l.nickname,
          tag: l.tag || '',
          sub: this.diffSub(l, index.get(normalizeTagClient(l.tag)) || {}),
          action: l,
          checked: false,
        });
      }
      return list;
    },

    togglePick(c) {
      c.checked = !c.checked;
    },

    selectGroup(group, on) {
      this.picks.forEach((p) => {
        if (p.group === group) p.checked = on;
      });
    },

    // 读取游戏数据(只读; 每次都强制拿最新, 避免 10 分钟缓存误导)
    async loadDiff() {
      if (this.cocLoading) return;
      this.cocLoading = true;
      try {
        const diff = await post('/coc/preview', { no_cache: true });
        this.diff = diff;
        this.picks = this.buildPicks(diff);
        this.applyResult = null;
        this.coc = { ...this.coc, local_in_tribe: (this.coc.local_in_tribe || 0), clan_tag: diff.clan.tag || this.coc.clan_tag };
        if (diff.clan && diff.clan.tag) this.clanTagInput = diff.clan.tag;
        if (!this.picks.length) uni.showToast({ title: '本地与游戏内一致，无需同步', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message || '读取游戏数据失败', icon: 'none', duration: 3000 });
      } finally {
        this.cocLoading = false;
      }
    },

    // 应用结果文案
    actionLabel(a) {
      const who = a.nickname || (a.member_id ? `#${a.member_id}` : '');
      if (a.type === 'add') return `新增 ${who}（${this.statusText(a.status)}）`;
      if (a.type === 'tag') return `${who} 写入标签 ${a.tag}`;
      if (a.type === 'status') return `${who} 状态改为 ${this.statusText(a.status)}`;
      if (a.type === 'rejoin') return `${who} 回到部落`;
      if (a.type === 'leave') return `${who} 记为离开`;
      return `${a.type} ${who}`;
    },

    // 统一的应用入口
    async runApply(payload, okText) {
      if (this.applying) return;
      this.applying = true;
      try {
        const res = await post('/coc/apply', payload);
        this.applyResult = res;
        const parts = [`成功 ${res.applied_count}`];
        if (res.skipped_count) parts.push(`跳过 ${res.skipped_count}`);
        if (res.failed_count) parts.push(`失败 ${res.failed_count}`);
        uni.showToast({ title: `${okText}：${parts.join(' · ')}`, icon: 'none', duration: 3000 });
        if (res.warning) {
          setTimeout(() => uni.showToast({ title: res.warning, icon: 'none', duration: 3500 }), 3100);
        }
        return res;
      } catch (e) {
        uni.showToast({ title: e.message || '应用失败', icon: 'none', duration: 3000 });
        return null;
      } finally {
        this.applying = false;
      }
    },

    // 「导入新增成员」: 服务端自己重新拉官方名单, 只自动新增
    async applyAutoAdd() {
      if (!this.autoAddCount) return uni.showToast({ title: '没有需要新增的成员', icon: 'none' });
      const res = await this.runApply({ actions: [], auto_add: true }, '新增成员');
      if (res) await this.loadDiff();
    },

    // 「应用勾选项」: 人工确认过的状态变更 / 标签 / 离开
    async applyPicked() {
      const actions = this.pickedActions;
      if (!actions.length) return uni.showToast({ title: '请先勾选要应用的变更', icon: 'none' });
      // "新增"由 auto_add 统一走官方最新名单, 这里只提交非新增动作, 避免用到过期预览
      const manual = actions.filter((a) => a.type !== 'add');
      const autoAdd = actions.some((a) => a.type === 'add');
      if (!manual.length && !autoAdd) return uni.showToast({ title: '没有可应用的变更', icon: 'none' });
      const res = await this.runApply({ actions: manual, auto_add: autoAdd }, '应用变更');
      if (res) await this.loadDiff();
    },

    // 按标签查询(只读)
    async searchTags() {
      if (this.lookupLoading) return;
      this.lookupLoading = true;
      try {
        const res = await post('/coc/lookup', { text: this.lookupText, no_cache: true });
        this.lookup = res;
        this.lookupPicks = (res.items || []).map((it, i) => ({
          key: `lk-${it.tag}-${i}`,
          tag: it.tag,
          title: it.error ? `${it.tag}（查询失败）` : it.name || '（无昵称）',
          sub: this.lookupSub(it),
          action: it.action,
          checked: !!(it.action && it.action.type === 'add'),
        }));
        if (res.truncated) {
          uni.showToast({ title: `只查了前 ${res.max_tags} 个标签`, icon: 'none' });
        }
      } catch (e) {
        this.lookup = null;
        this.lookupPicks = [];
        uni.showToast({ title: e.message || '查询失败', icon: 'none', duration: 3000 });
      } finally {
        this.lookupLoading = false;
      }
    },

    lookupSub(it) {
      if (it.error) return it.error;
      const bits = [];
      if (it.town_hall) bits.push(`大本 ${it.town_hall}`);
      if (it.war_preference) bits.push(`战意 ${it.war_preference}`);
      bits.push(it.in_clan ? '在本部落' : '不在本部落');
      if (it.local) bits.push(`本地 ${it.local.nickname}（${it.local.status_text}）`);
      else bits.push('本地无记录');
      if (it.note) bits.push(it.note);
      return bits.join(' · ');
    },

    toggleLookupPick(c) {
      if (!c.action) return;
      c.checked = !c.checked;
    },

    selectAllLookup(on) {
      this.lookupPicks.forEach((p) => {
        if (p.action) p.checked = on;
      });
    },

    // 导入勾选的标签(新增 / 改状态都走同一个 apply)
    async applyLookup() {
      const actions = this.lookupPicks.filter((p) => p.checked && p.action).map((p) => p.action);
      if (!actions.length) return uni.showToast({ title: '请先勾选要导入的成员', icon: 'none' });
      const res = await this.runApply({ actions, auto_add: false }, '导入标签');
      if (res) await this.searchTags();
    },
  }
};

// 本地判断标签(与后端 normalizeTag 同口径, 仅用于展示匹配)
function normalizeTagClient(tag) {
  const s = String(tag == null ? '' : tag).trim().toUpperCase().replace(/^#+/, '');
  return s ? '#' + s : '';
}
</script>

<style scoped>
/* 基础样式 */
.page {
  min-height: 100vh;
  padding: 24rpx;
  background: #f4f6fb;
  color: #1f2937;
}

/* 头部 */
.header {
  margin-bottom: 24rpx;
}

.title {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
}

.subtitle {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #6b7280;
}

/* 导入方式切换 */
.modes {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.mode {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  background: #fff;
  border: 2rpx solid #e5e7eb;
}

.mode.on {
  border-color: #4361ee;
  background: #f0f4ff;
}

.mode-icon {
  font-size: 36rpx;
}

.mode-body {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.mode-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #1f2937;
}

.mode.on .mode-title {
  color: #4361ee;
}

.mode-sub {
  font-size: 20rpx;
  color: #9ca3af;
  line-height: 1.4;
}

/* 子方式切换 */
.subtabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 24rpx;
  padding: 8rpx;
  background: #f3f4f6;
  border-radius: 14rpx;
}

.subtab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  padding: 14rpx 10rpx;
  border-radius: 10rpx;
}

.subtab.on {
  background: #fff;
  box-shadow: 0 2rpx 8rpx rgba(67, 97, 238, 0.12);
}

.subtab-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #6b7280;
}

.subtab.on .subtab-title {
  color: #4361ee;
}

.subtab-sub {
  font-size: 20rpx;
  color: #9ca3af;
}

/* 流程步骤 */
.steps {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 28rpx;
  padding: 0 40rpx;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.step-number {
  width: 36rpx;
  height: 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e5e7eb;
  color: #9ca3af;
  font-size: 20rpx;
  font-weight: 600;
}

.step.active .step-number {
  background: #4361ee;
  color: #fff;
}

.step.done .step-number {
  background: #10b981;
  color: #fff;
}

.step-label {
  font-size: 20rpx;
  color: #9ca3af;
}

.step.active .step-label,
.step.done .step-label {
  color: #4361ee;
}

.step-line {
  width: 80rpx;
  height: 2rpx;
  background: #e5e7eb;
  margin: 0 16rpx;
}

/* 卡片 */
.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

/* 输入区域 */
.input-section {
  margin-bottom: 24rpx;
}

.input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.label {
  font-size: 28rpx;
  font-weight: 600;
}

.format-tips {
  margin-bottom: 16rpx;
}

.tip-trigger {
  display: flex;
  align-items: center;
  gap: 6rpx;
  font-size: 24rpx;
  color: #4361ee;
}

.tip-icon {
  font-size: 28rpx;
}

/* 格式说明 */
.format-examples {
  background: #f0f4ff;
  border-radius: 12rpx;
  padding: 20rpx;
  margin-bottom: 16rpx;
}

.example-title {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  color: #4361ee;
  margin-bottom: 12rpx;
}

.example {
  display: flex;
  gap: 12rpx;
  padding: 8rpx 0;
  font-size: 24rpx;
  line-height: 1.6;
}

.example-label {
  color: #6b7280;
  min-width: 140rpx;
}

.example-content {
  color: #1f2937;
}

.example-content.mono {
  font-family: monospace;
  white-space: pre-wrap;
}

/* 输入框 */
.input-textarea {
  width: 100%;
  height: 320rpx;
  background: #f9fafb;
  border: 2rpx solid #e5e7eb;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 26rpx;
  box-sizing: border-box;
  margin-bottom: 16rpx;
  line-height: 1.6;
}

.lookup-textarea {
  height: 240rpx;
}

.input-stats {
  display: flex;
  justify-content: space-between;
  font-size: 22rpx;
  color: #6b7280;
  margin-bottom: 20rpx;
}

.stat.limit.warn {
  color: #b45309;
}

/* 选项区域 */
.option-section {
  margin-bottom: 24rpx;
}

.checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  font-size: 26rpx;
  color: #374151;
  line-height: 1.6;
}

.option-hint {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #9ca3af;
  line-height: 1.6;
}

/* 部落标签配置 */
.field {
  margin-bottom: 24rpx;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;
}

.input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  background: #f9fafb;
  border: 2rpx solid #e5e7eb;
  border-radius: 12rpx;
  font-size: 26rpx;
  box-sizing: border-box;
}

/* 按钮 */
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  border-radius: 14rpx;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1;
}

.btn.large {
  margin-top: 20rpx;
}

.btn.primary {
  background: #4361ee;
  color: #fff;
}

.btn.secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn.small {
  height: 64rpx;
  font-size: 24rpx;
  padding: 0 24rpx;
}

.btn[disabled] {
  opacity: 0.5;
}

.button-group {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.button-group .btn {
  flex: 1;
}

/* 预览区域 */
.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.card-title {
  font-size: 30rpx;
  font-weight: 700;
}

/* 统计卡片 */
.summary-stats {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
  overflow-x: auto;
  padding-bottom: 8rpx;
  -webkit-overflow-scrolling: touch;
}

.stat-card {
  flex: 1;
  min-width: 120rpx;
  padding: 20rpx 16rpx;
  border-radius: 14rpx;
  text-align: center;
}

.stat-card.success {
  background: #ecfdf5;
  color: #059669;
}

.stat-card.neutral {
  background: #f3f4f6;
  color: #374151;
}

.stat-card.warning {
  background: #fff8e8;
  color: #9a6700;
}

.stat-card.error {
  background: #fef2f2;
  color: #b91c1c;
}

.stat-value {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
}

.stat-label {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
}

/* 总人数提醒 */
.total-warning {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 24rpx;
  border-radius: 12rpx;
  background: #f0f4ff;
  color: #4361ee;
  font-size: 24rpx;
  line-height: 1.6;
}

.total-warning.error {
  background: #fef2f2;
  color: #b91c1c;
}

.warning-icon {
  flex-shrink: 0;
  font-size: 24rpx;
}

/* 警告框 */
.warning-box {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 24rpx;
  border-radius: 12rpx;
  background: #fff8e8;
  color: #9a6700;
  font-size: 24rpx;
  line-height: 1.6;
}

.warning-box.error {
  background: #fef2f2;
  color: #b91c1c;
}

/* 成员区域 */
.member-section {
  margin-bottom: 24rpx;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 12rpx;
  font-size: 26rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
}

.section-head .section-title {
  margin-bottom: 0;
}

.bulk {
  display: flex;
  gap: 20rpx;
}

.show-more {
  font-size: 22rpx;
  color: #4361ee;
}

.hint {
  font-size: 22rpx;
  color: #6b7280;
  line-height: 1.6;
}

.empty {
  padding: 32rpx 24rpx;
  border-radius: 12rpx;
  background: #f8f9ff;
  color: #6b7280;
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
}

/* 差异勾选列表 */
.diff-body {
  margin-top: 24rpx;
}

.pick-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 12rpx;
}

.pick {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 18rpx;
  border-radius: 12rpx;
  background: #f9fafb;
  border: 2rpx solid #eef0f4;
}

.pick.on {
  background: #f0f4ff;
  border-color: #4361ee;
}

.pick.disabled {
  opacity: 0.55;
}

.tick {
  flex-shrink: 0;
  width: 40rpx;
  height: 40rpx;
  margin-top: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2rpx solid #cbd5e1;
  background: #fff;
}

.tick.on {
  background: #4361ee;
  border-color: #4361ee;
}

.tick-mark {
  color: #fff;
  font-size: 24rpx;
  line-height: 1;
}

.pick-body {
  flex: 1;
  min-width: 0;
}

.pick-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}

.pick-title {
  font-size: 26rpx;
  color: #1f2937;
  font-weight: 600;
  word-break: break-all;
}

.pick-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #6b7280;
  line-height: 1.6;
}

/* 成员网格 */
.member-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280rpx, 1fr));
  gap: 12rpx;
}

.member-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx;
  padding: 16rpx;
  border-radius: 12rpx;
  background: #f8f9ff;
}

.member-card.conflict {
  background: #fff8e8;
}

.member-name {
  font-size: 26rpx;
  color: #1f2937;
  word-break: break-all;
}

.member-tag {
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  background: #eef2ff;
  color: #4361ee;
  font-size: 22rpx;
}

.member-remark {
  font-size: 22rpx;
  color: #6b7280;
}

/* 重名成员的更新(牌子变化 / 资料变化) */
.update-summary {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin: 20rpx 0 8rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  background: #eef2ff;
}

.update-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.update-title {
  color: #3b4a6b;
  font-size: 24rpx;
  font-weight: 600;
}

.update-detail {
  color: #64748b;
  font-size: 21rpx;
}

/* 确认页: 重名成员的两类更新要不要写库 */
.apply-options {
  margin: 20rpx 0 8rpx;
  padding: 20rpx;
  border: 2rpx solid #dbe3fb;
  border-radius: 16rpx;
  background: #f7f9ff;
}

.apply-title {
  display: block;
  margin-bottom: 8rpx;
  color: #2f3a56;
  font-size: 24rpx;
  font-weight: 700;
}

.apply-option {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 0;
}

.apply-label {
  flex: 1;
  color: #1f2937;
  font-size: 24rpx;
}

.apply-detail {
  color: #6b7280;
  font-size: 21rpx;
}

.apply-hint {
  display: block;
  margin-top: 6rpx;
  color: #8a93a6;
  font-size: 20rpx;
  line-height: 1.6;
}

.example-hint {
  display: block;
  margin-top: 10rpx;
  color: #8a93a6;
  font-size: 20rpx;
  line-height: 1.6;
}

/* 错误区域 */
.error-section {
  margin-bottom: 24rpx;
}

.error-list {
  background: #fef2f2;
  border-radius: 12rpx;
  padding: 16rpx;
}

.error-item {
  display: block;
  padding: 8rpx 0;
  font-size: 24rpx;
  color: #b91c1c;
  line-height: 1.6;
}

/* 同步结果 */
.result-box {
  margin-top: 28rpx;
  padding: 20rpx;
  border-radius: 14rpx;
  background: #f8f9ff;
  border: 2rpx solid #eef2ff;
}

.result-line {
  display: block;
  font-size: 24rpx;
  color: #374151;
  line-height: 1.6;
  margin-bottom: 12rpx;
}

.result-line.warn {
  color: #b45309;
  margin-top: 12rpx;
  margin-bottom: 0;
}

.result-item {
  display: block;
  padding: 6rpx 0;
  font-size: 23rpx;
  line-height: 1.6;
}

.result-item.ok {
  color: #059669;
}

.result-item.skip {
  color: #6b7280;
}

.result-item.err {
  color: #b91c1c;
}

/* 确认区域 */
.confirm-header {
  margin-bottom: 20rpx;
}

.confirm-summary {
  background: #f0f4ff;
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  padding: 12rpx 0;
  font-size: 26rpx;
  color: #374151;
  border-bottom: 2rpx solid #e5e7eb;
}

.summary-item:last-child {
  border-bottom: none;
}

.summary-label {
  color: #6b7280;
}

.summary-value {
  font-weight: 600;
  color: #4361ee;
}

.summary-item.highlight .summary-value {
  font-size: 32rpx;
}

/* 适配小屏幕 */
@media screen and (max-width: 350px) {
  .steps {
    padding: 0 20rpx;
  }

  .step-line {
    width: 40rpx;
  }

  .summary-stats {
    flex-wrap: wrap;
  }

  .stat-card {
    min-width: 100rpx;
  }

  .member-grid {
    grid-template-columns: 1fr;
  }

  .modes {
    flex-direction: column;
  }
}
</style>
