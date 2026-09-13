<template>
  <view class="page">
    <!-- 顶部工作台 -->
    <view class="heading">
      <view class="hero-orbit"></view>

      <view class="hero-main">
        <view class="hero-copy">
          <text class="eyebrow">TRIBE CREATIVE STUDIO</text>
          <text class="title">让灵感，有画面</text>
          <text class="subtitle">部落创作工坊 · 把脑海里的想象变成作品</text>
        </view>
        <view class="hero-symbol">✦</view>
      </view>

      <view class="hero-foot">
        <view class="privacy-pill">
          <view class="privacy-dot"></view>
          <text>默认保存到当前浏览器</text>
        </view>
        <text class="hero-foot-note">主动上传 · 才会分享</text>
      </view>
    </view>

    <!-- 主标签 -->
    <view class="tabs">
      <button
        v-for="item in tabs"
        :key="item.value"
        class="tab"
        :class="{ active: tab === item.value }"
        @click="changeTab(item.value)"
      >
        <text class="tab-symbol">
          {{ item.value === 'create' ? '✦' : item.value === 'local' ? '▧' : '▦' }}
        </text>
        <text>{{ item.label }}</text>
      </button>
    </view>

    <!-- 初始化状态 -->
    <view v-if="!config" class="card state-card">
      <view class="state-illustration" :class="{ breathing: !pageError }">
        {{ pageError ? '!' : '✦' }}
      </view>
      <text class="state-title">
        {{ pageError ? '工坊暂时没有连接成功' : '正在准备你的创作空间' }}
      </text>
      <text class="state-description">
        {{ pageError || '正在读取配置与使用额度，请稍候…' }}
      </text>
      <button v-if="pageError" class="button" @click="initialize">
        重新加载
      </button>
    </view>

    <block v-else>
      <!-- ================= 创作 ================= -->
      <block v-if="tab === 'create'">
        <view v-if="!config.can_create" class="card state-card">
          <view class="state-illustration">▧</view>
          <text class="state-title">先来看看大家的灵感</text>
          <text class="state-description">
            当前账号暂时不能生成图片，可以在部落图库预览和下载作品。
          </text>
          <button class="button primary" @click="changeTab('gallery')">
            浏览部落图库
          </button>
        </view>

        <block v-else>
          <!-- 创作模式 -->
          <view class="section-heading">
            <view class="section-heading-left">
              <view class="heading-mark"></view>
              <text class="section-title">选择创作方式</text>
            </view>
            <text class="muted">从一个想法开始</text>
          </view>

          <view class="mode-switch">
            <button
              class="mode-button"
              :class="{ active: creationMode === 'general' }"
              :disabled="!!pending || busy"
              @click="switchCreationMode('general')"
            >
              <view class="mode-icon general-icon">✦</view>
              <view class="mode-copy">
                <text class="mode-title">通用创作</text>
                <text class="mode-desc">头像 / 配图 / 自由想象</text>
              </view>
              <view class="mode-radio"></view>
            </button>

            <button
              class="mode-button oriental-mode"
              :class="{ active: creationMode === 'oriental' }"
              :disabled="!!pending || busy"
              @click="switchCreationMode('oriental')"
            >
              <view class="mode-icon oriental-icon">幻</view>
              <view class="mode-copy">
                <text class="mode-title">东方幻境</text>
                <text class="mode-desc">仙侠 / 人像 / 细节设定</text>
              </view>
              <view class="mode-radio"></view>
            </button>
          </view>

          <!-- 通用模板 -->
          <view v-if="creationMode === 'general'" class="card template-card">
            <view class="label-row">
              <view>
                <text class="section-title">灵感起点</text>
                <text class="section-subtitle">选一个方向，也可以直接写下你的想法</text>
              </view>
              <text class="corner-symbol">✧</text>
            </view>

            <view class="template-grid">
              <button
                v-for="(item, index) in templates"
                :key="item.name"
                class="template-button"
                :class="{ selected: prompt === item.prompt }"
                :disabled="!!pending || busy"
                @click="useTemplate(item)"
              >
                <text class="template-icon">
                  {{ ['✎', '🛡️', '🏰', '👑', '🐉'][index] || '✦' }}
                </text>
                <text>{{ item.name }}</text>
              </button>
            </view>
          </view>

          <!-- 东方幻境 -->
          <view v-else class="card oriental-panel">
            <view class="oriental-header">
              <text class="oriental-eyebrow">ORIENTAL FANTASY</text>
              <text class="oriental-title">一笔入幻境</text>
              <text class="oriental-description">
                中式写实、黑发深瞳、自然柔光。从人物姿态到衣袖细节，慢慢描绘你的角色。
              </text>
            </view>

            <view class="form-section">
              <view class="form-section-heading">
                <text class="step-number">01</text>
                <text class="form-section-title">人物与构图</text>
              </view>

              <text class="field-label">人物设定</text>
              <view class="choice-row">
                <button
                  class="choice-button"
                  :class="{ active: orientalForm.character === 'woman' }"
                  :disabled="!!pending || busy"
                  @click="setOrientalOption('character', 'woman')"
                >
                  成年女性
                </button>
                <button
                  class="choice-button"
                  :class="{ active: orientalForm.character === 'man' }"
                  :disabled="!!pending || busy"
                  @click="setOrientalOption('character', 'man')"
                >
                  成年男性
                </button>
              </view>

              <text class="field-label">画面构图</text>
              <view class="choice-row">
                <button
                  class="choice-button"
                  :class="{ active: orientalForm.composition === 'portrait' }"
                  :disabled="!!pending || busy"
                  @click="setOrientalOption('composition', 'portrait')"
                >
                  半身人像
                </button>
                <button
                  class="choice-button"
                  :class="{ active: orientalForm.composition === 'fullbody' }"
                  :disabled="!!pending || busy"
                  @click="setOrientalOption('composition', 'fullbody')"
                >
                  完整全身
                </button>
              </view>

              <text class="description">
                全身构图要求人物完整入镜；未手动选尺寸时会自动切换竖图。实际构图仍以模型输出为准。
              </text>
            </view>

            <view class="form-section">
              <view class="form-section-heading">
                <text class="step-number">02</text>
                <text class="form-section-title">动作与神态</text>
              </view>

              <view class="choice-row">
                <button
                  v-for="item in orientalActions"
                  :key="item.name"
                  class="choice-button"
                  :class="{ active: orientalForm.action === item.value }"
                  :disabled="!!pending || busy"
                  @click="selectOrientalAction(item)"
                >
                  {{ item.name }}
                </button>
              </view>

              <textarea
                v-model="orientalForm.action"
                class="oriental-textarea"
                maxlength="160"
                :disabled="!!pending || busy"
                placeholder="描述姿态、手势、神态和视线，不填写角色台词"
              />
              <text class="field-count">{{ charCount(orientalForm.action) }}/160</text>
            </view>

            <view class="form-section">
              <view class="form-section-heading">
                <text class="step-number">03</text>
                <text class="form-section-title">服装与氛围</text>
              </view>

              <text class="field-label">服装与配饰</text>
              <textarea
                v-model="orientalForm.outfit"
                class="oriental-textarea short"
                maxlength="140"
                :disabled="!!pending || busy"
                placeholder="如：月白交领长裙、玉簪、细银纹袖口"
              />
              <text class="field-count">{{ charCount(orientalForm.outfit) }}/140</text>

              <text class="field-label">环境与光线</text>
              <input
                v-model="orientalForm.scene"
                class="oriental-input"
                maxlength="80"
                :disabled="!!pending || busy"
                placeholder="如：黄昏庭院、窗边柔光"
              />

              <text class="field-label">
                补充细节 <text class="optional">选填</text>
              </text>
              <input
                v-model="orientalForm.extra"
                class="oriental-input"
                maxlength="80"
                :disabled="!!pending || busy"
                placeholder="如：发梢轻动，衣袖有细致刺绣"
              />
            </view>

            <!-- 默认折叠，不改变原导入逻辑 -->
            <view class="bracket-import">
              <button
                class="import-toggle"
                :disabled="!!pending || busy"
                @click="showBracketImport = !showBracketImport"
              >
                <view class="import-toggle-copy">
                  <text class="import-title">从旧剧情提取动作</text>
                  <text class="import-desc">已有描述？提取括号内容，减少重复输入</text>
                </view>
                <text class="import-arrow">{{ showBracketImport ? '−' : '+' }}</text>
              </button>

              <view v-if="showBracketImport" class="import-body">
                <textarea
                  v-model="orientalSource"
                  class="oriental-textarea short"
                  maxlength="1000"
                  :disabled="!!pending || busy"
                  placeholder="例如：（她倚坐窗边，右手托颊。）今天的天气真好。"
                />
                <button
                  class="button"
                  :disabled="!!pending || busy || !orientalSource.trim()"
                  @click="importBracketAction"
                >
                  提取到动作栏
                </button>
              </view>
            </view>

            <button
              class="button oriental-apply"
              :disabled="!!pending || busy"
              @click="applyOrientalPrompt"
            >
              ✦ {{ prompt ? '重新整理提示词' : '将设定整理成提示词' }}
            </button>

            <text v-if="orientalNeedsApply" class="oriental-notice">
              设定尚未应用：可点上方的「整理提示词」，也可以直接在下面自己写提示词。
            </text>
          </view>

          <!-- 提示词和生成 -->
          <view class="card prompt-card">
            <view class="label-row">
              <view>
                <text class="section-title">
                  {{ creationMode === 'oriental' ? '确认你的画面描述' : '写下你想象的画面' }}
                </text>
                <text class="section-subtitle">
                  {{ creationMode === 'oriental' ? '最终提示词仍可手动编辑' : '主体 + 风格 + 场景，让表达更清晰' }}
                </text>
              </view>
              <text class="prompt-symbol">✎</text>
            </view>

            <view class="prompt-shell">
              <textarea
                v-model="prompt"
                class="prompt"
                maxlength="1000"
                :disabled="!!pending || busy"
                placeholder="例如：一只守护部落的小龙，穿金色铠甲，卡通插画，主体居中，背景简洁，无文字。"
                @input="onPromptEdited"
              />
              <view class="prompt-bottom">
                <text>灵感不必复杂，描述尽量具体</text>
                <text class="prompt-count">{{ charCount(prompt) }}/1000</text>
              </view>
            </view>

            <view class="style-entry-row">
              <button
                class="style-entry"
                :disabled="!!pending || busy"
                @click="openStyleLibrary"
              >
                <text class="style-entry-icon">✧</text>
                <text class="style-entry-title">风格提示词库</text>
                <text class="style-entry-meta">{{ styleTotal }} 种手绘风格</text>
              </button>
              <text class="style-entry-hint">
                不会描述画风？挑一个编号，可填入本页，也可以复制到其它 AI 生成提示词。
              </text>
            </view>

            <view class="info-line">
              <text class="parameter-chip">
                {{ creationMode === 'oriental' ? selectedSize : config.image_size }}
              </text>
              <text class="model-name">{{ config.model }}</text>
            </view>

            <block v-if="creationMode === 'oriental'">
              <text class="field-label">画面尺寸</text>
              <view class="choice-row">
                <button
                  v-for="item in imageSizes"
                  :key="item.value"
                  class="choice-button"
                  :class="{ active: selectedSize === item.value }"
                  :disabled="!!pending || busy"
                  @click="chooseSize(item.value)"
                >
                  {{ item.label }}
                </button>
              </view>
            </block>

            <view class="writing-tip">
              <text class="tip-symbol">ⓘ</text>
              <text>昵称、部落名称等准确文字建议后期添加，模型直接画字可能不准确。</text>
            </view>

            <view class="generate-area">
              <view class="quota-line">
                <view class="quota-dot" :class="{ exhausted: quotaExhausted }"></view>
                <text>{{ quotaText }}</text>
              </view>

              <button
                v-if="!pending"
                class="button primary generate-button"
                :disabled="generateDisabled"
                @click="generate"
              >
                <text class="generate-spark">✦</text>
                <text>{{ generateLabel }}</text>
              </button>

              <view v-else class="task-box">
                <view class="task-heading">
                  <view class="task-symbol" :class="{ breathing: !taskError }">✦</view>
                  <view class="task-copy">
                    <text class="task-title">{{ taskText || '正在恢复当前任务…' }}</text>
                    <text class="task-description">
                      {{ taskError ? '任务暂未确认，可查询当前状态' : '任务编号已保留，无需重复提交' }}
                    </text>
                  </view>
                </view>
                <button v-if="!busy" class="button" @click="resumeTask">
                  查询 / 恢复当前任务
                </button>
              </view>

              <text class="save-hint">生成后尝试保存到本机图库，不会自动上传部落</text>
            </view>

            <text v-if="taskError" class="error">{{ taskError }}</text>
          </view>

          <!-- 生成结果 -->
          <view v-if="result" class="card result-card">
            <view class="label-row">
              <view>
                <text class="section-title">你的灵感，已成画</text>
                <text class="section-subtitle">点击图片，查看完整细节</text>
              </view>
              <text class="result-badge">AI 作品</text>
            </view>

            <image
              class="result-image"
              :src="result.url"
              mode="widthFix"
              @click="previewResult"
            />

            <view class="save-status" :class="{ unsaved: !result.saved }">
              <text class="save-status-icon">{{ result.saved ? '✓' : '!' }}</text>
              <text>
                {{ result.saved ? '已保存到当前浏览器' : '本机尚未保存，请先下载或重试保存' }}
              </text>
            </view>

            <view class="button-row">
              <button class="button action-main" @click="downloadResult">下载图片</button>
              <button class="button" @click="previewResult">查看大图</button>
              <button
                v-if="!result.saved"
                class="button"
                :disabled="busy"
                @click="retryLocalSave"
              >
                重试保存
              </button>
              <button
                v-else
                class="button"
                :disabled="busy"
                @click="uploadLocal(result.meta)"
              >
                上传部落
              </button>
            </view>

            <text class="description">分享由你决定：未点击上传的图片不会进入部落图库。</text>
          </view>
        </block>
      </block>

      <!-- ================= 本机图库 ================= -->
      <block v-if="tab === 'local'">
        <view class="notice">
          <view class="notice-icon">▧</view>
          <view class="notice-copy">
            <text class="notice-title">只在这台设备的当前浏览器里</text>
            <text>
              清理网站数据、更换设备或无痕浏览可能导致作品丢失，重要图片请及时下载。
            </text>
          </view>
        </view>

        <view class="gallery-heading">
          <view class="heading-left">
            <text class="section-title">我的本机作品</text>
            <text class="count-badge">{{ localItems.length }}</text>
          </view>
          <button class="text-button" @click="loadLocal">↻ 刷新</button>
        </view>

        <view class="image-grid">
          <view v-for="item in localVisible" :key="item.id" class="image-card">
            <view class="thumbnail-wrap" @click="previewLocal(item)">
              <image
                :src="thumbs[item.id] || ''"
                mode="aspectFill"
                class="thumbnail"
                :lazy-load="true"
              />
              <text class="image-overlay-tag">本机作品</text>
              <view class="image-view-hint">查看大图 ↗</view>
            </view>

            <view class="image-card-body">
              <text class="image-caption">{{ item.prompt || '部落创作图片' }}</text>

              <view class="small-actions">
                <button @click="downloadLocal(item)">下载</button>
                <button @click="reusePrompt(item)">复用描述</button>
              </view>

              <view class="small-actions secondary-actions">
                <button
                  v-if="config.can_create"
                  :disabled="busy"
                  :class="{ tagged: !!item.serverId }"
                  @click="uploadLocal(item)"
                >
                  {{ item.serverId ? '曾上传部落' : '上传部落' }}
                </button>
                <button class="danger" :disabled="busy" @click="removeLocal(item)">
                  删除本机
                </button>
              </view>
            </view>
          </view>
        </view>

        <view v-if="!localItems.length" class="card state-card gallery-empty">
          <view class="state-illustration">✎</view>
          <text class="state-title">第一幅作品，从一个想法开始</text>
          <text class="state-description">成功保存的生成图片，会出现在这里。</text>
          <button
            v-if="config.can_create"
            class="button"
            @click="changeTab('create')"
          >
            去创作一张
          </button>
        </view>

        <button
          v-if="localVisible.length < localItems.length"
          class="button load-more"
          @click="moreLocal"
        >
          加载更多作品
        </button>
      </block>

      <!-- ================= 部落图库 ================= -->
      <block v-if="tab === 'gallery'">
        <view class="card gallery-summary">
          <view class="label-row">
            <view>
              <text class="section-title">让灵感，在部落相遇</text>
              <text class="section-subtitle">这里展示成员主动上传的作品</text>
            </view>
            <text class="corner-symbol">▦</text>
          </view>

          <view class="storage-stats">
            <view class="storage-stat">
              <view>
                <text class="stat-value">{{ config.quota.total }}</text>
                <text class="stat-limit"> / {{ config.quota.total_limit }}</text>
              </view>
              <text class="stat-label">部落总存储</text>
            </view>
            <view class="storage-stat">
              <view>
                <text class="stat-value">{{ config.quota.ip }}</text>
                <text class="stat-limit"> / {{ config.quota.ip_limit }}</text>
              </view>
              <text class="stat-label">当前 IP</text>
            </view>
            <view class="storage-stat">
              <view>
                <text class="stat-value">{{ config.quota.actor }}</text>
                <text class="stat-limit"> / {{ config.quota.actor_limit }}</text>
              </view>
              <text class="stat-label">当前身份</text>
            </view>
          </view>

          <text v-if="config.can_create" class="upload-quota">
            {{
              config.upload_unlimited
                ? '每日上传不限次数，仍受图库存储名额限制'
                : '今日已上传 ' + config.upload_used + ' / ' + config.upload_limit + ' 张'
            }}
          </text>
        </view>

        <view class="gallery-heading">
          <view class="heading-left">
            <text class="section-title">部落作品集</text>
            <text class="count-badge">第 {{ galleryPage }} 页</text>
          </view>
          <button class="text-button" @click="loadGallery">↻ 刷新</button>
        </view>

        <view class="image-grid">
          <view v-for="item in galleryItems" :key="item.id" class="image-card">
            <view class="thumbnail-wrap" @click="previewServer(item)">
              <image
                :src="thumbs['server_' + item.id] || ''"
                mode="aspectFill"
                class="thumbnail"
                :lazy-load="true"
              />
              <text class="image-overlay-tag" :class="{ mine: item.mine }">
                {{ item.mine ? '我的分享' : '部落分享' }}
              </text>
              <view class="image-view-hint">查看大图 ↗</view>
            </view>

            <view class="image-card-body">
              <text class="image-caption server-caption">
                {{ item.mine ? '我上传的图片' : '来自部落的一份灵感' }}
              </text>
              <view class="small-actions">
                <button @click="downloadServer(item)">下载图片</button>
                <button
                  v-if="item.can_delete"
                  class="danger"
                  :disabled="busy"
                  @click="removeServer(item)"
                >
                  删除
                </button>
              </view>
            </view>
          </view>
        </view>

        <view v-if="!galleryItems.length" class="card state-card gallery-empty">
          <view class="state-illustration">▦</view>
          <text class="state-title">这里还没有作品</text>
          <text class="state-description">
            成员主动上传的图片会展示在这里，期待第一份灵感。
          </text>
        </view>

        <view class="pagination">
          <button
            class="button"
            :disabled="galleryPage <= 1 || busy"
            @click="changeGalleryPage(-1)"
          >
            ‹ 上一页
          </button>
          <text class="page-number">{{ galleryPage }}</text>
          <button
            class="button"
            :disabled="!galleryHasMore || busy"
            @click="changeGalleryPage(1)"
          >
            下一页 ›
          </button>
        </view>
      </block>

      <text v-if="pageError" class="error page-error">{{ pageError }}</text>
    </block>

    <view class="footer">
      <text>✦</text>
      <text>想象没有边界，分享由你决定</text>
      <text>✦</text>
    </view>

    <!-- ================= 图片预览 ================= -->
    <view v-if="preview" class="preview-mask" @click="closePreview">
      <view class="preview-panel" @click.stop>
        <view class="preview-header">
          <view>
            <text class="preview-title">作品预览</text>
            <text class="preview-subtitle">CREATIVE STUDIO</text>
          </view>
          <button class="preview-close" @click="closePreview">×</button>
        </view>

        <scroll-view scroll-y class="preview-scroll">
          <image
            :src="preview.url"
            mode="widthFix"
            class="preview-image"
            :show-menu-by-longpress="true"
          />
        </scroll-view>

        <view class="preview-actions">
          <button class="preview-download" @click="downloadPreview">下载图片</button>
          <button class="preview-back" @click="closePreview">返回工坊</button>
        </view>
        <text class="preview-tip">
          微信等内置浏览器若未开始下载，可尝试长按图片保存，或在系统浏览器打开。
        </text>
      </view>
    </view>

    <!-- ================= 风格提示词库 ================= -->
    <view v-if="styleLibraryOpen" class="library-mask" @click="closeStyleLibrary">
      <view class="library-panel" @click.stop>
        <view class="library-header">
          <view class="library-heading">
            <text class="library-title">风格提示词库</text>
            <text class="library-subtitle">
              {{ styleTotal }} 种手绘风格 · 分 {{ styleGroupTabs.length }} 类 · 可复制到其它 AI
            </text>
          </view>
          <button class="library-close" @click="closeStyleLibrary">×</button>
        </view>

        <text class="library-field-label">按编号找风格（也可以搜作者、风格名或特征）</text>
        <input
          v-model="styleKeyword"
          class="library-input library-search"
          maxlength="24"
          placeholder="例如 041、水彩、绘本…"
        />

        <scroll-view scroll-x class="library-tabs">
          <view
            class="library-tab"
            :class="{ active: styleGroup === '' }"
            @click="pickStyleGroup('')"
          >
            全部 {{ styleMatches.length }}
          </view>
          <view
            v-for="group in styleGroupTabs"
            :key="group.id"
            class="library-tab"
            :class="{ active: styleGroup === group.id }"
            @click="pickStyleGroup(group.id)"
          >
            <text class="library-tab-id">{{ group.id }}</text>
            <text>{{ group.short }} {{ group.count }}</text>
          </view>
        </scroll-view>

        <text class="library-group-name">{{ styleGroupName }}</text>

        <text v-if="styleCopiedText" class="library-status">✓ {{ styleCopiedText }}</text>

        <scroll-view scroll-y class="library-list">
          <view v-for="item in styleVisible" :key="item.number" class="library-item">
            <view class="library-item-main">
              <view class="library-thumb-box" @click="previewStyle(item)">
                <image
                  v-if="!styleThumbBroken[item.number]"
                  class="library-thumb"
                  :src="styleThumb(item.number)"
                  mode="aspectFill"
                  @error="onStyleThumbError(item.number)"
                />
                <text v-else class="library-thumb-fallback">{{ item.number }}</text>
              </view>

              <view class="library-item-text">
                <view class="library-item-head">
                  <text class="library-number">{{ item.number }}</text>
                  <text class="library-name">{{ item.name }}</text>
                </view>
                <text class="library-reference">
                  参考 {{ item.reference }} · 分类 {{ item.group }}
                </text>
                <text class="library-traits">
                  {{ item.traits || '上游未提供核心特征，直接用作者名 + 风格名描述即可。' }}
                </text>
              </view>
            </view>

            <view class="library-actions">
              <button class="library-action" @click="useStylePrompt(item)">
                填入提示词
              </button>
              <button
                class="library-action primary"
                :class="{ copied: styleCopied === item.number }"
                @click="copyStylePrompt(item)"
              >
                {{ styleCopied === item.number ? '已复制 ✓' : '复制画风' }}
              </button>
            </view>
          </view>

          <view v-if="!styleMatches.length" class="library-empty">
            <text>没有匹配的风格，换个关键词试试（例如 001、水彩、绘本）。</text>
          </view>

          <button v-if="styleMore" class="library-more" @click="showMoreStyles">
            继续显示，还有 {{ styleMore }} 条
          </button>
        </scroll-view>

        <text class="library-foot">
          风格数据与参考图来自 GitHub yang0/handraw-style（点图片可放大）。
          复制内容含编号、风格名、参考作者与核心视觉特征，粘到其它 AI 即可让它按这个画风出提示词或出图。
        </text>
      </view>
    </view>

    <!-- 风格参考图大图 -->
    <view v-if="stylePreview" class="style-viewer" @click="closeStylePreview">
      <view class="style-viewer-panel" @click.stop>
        <image class="style-viewer-image" :src="stylePreview.url" mode="widthFix" />
        <view class="style-viewer-meta">
          <text class="style-viewer-title">{{ stylePreview.number }} · {{ stylePreview.name }}</text>
          <text class="style-viewer-sub">
            参考 {{ stylePreview.reference }} · 分类 {{ stylePreview.group }}
          </text>
        </view>
        <button class="style-viewer-close" @click="closeStylePreview">关闭</button>
      </view>
    </view>
  </view>
</template>

<script>
// AI 创作工坊 (H5 + 原生 App)
//
// 后端契约 (server/src/modules/ai-workshop.js):
//   GET    /api/ai-workshop/config              配置 + 配额 + 每日已用
//   POST   /api/ai-workshop/jobs                入队生成 (client_token 幂等)
//   GET    /api/ai-workshop/jobs/:id            查任务
//   GET    /api/ai-workshop/jobs/:id/image      取临时生成图 (上传前唯一来源)
//   GET    /api/ai-workshop/gallery             图库列表 (访客可读)
//   GET    /api/ai-workshop/gallery/:id/image   图库图片 (thumb=1 取缩略图)
//   POST   /api/ai-workshop/gallery             主动上传 (client_token 幂等)
//   DELETE /api/ai-workshop/gallery/:id         删除 (释放配额)
//
// 关键行为:
//   - 刷新/返回页面后靠本地保存的 client_token 恢复任务, 不会重复提交;
//   - 东方幻境的参数改动用 revision 标记, 未"生成提示词"前不允许生图;
//   - 手动改过的最终提示词不会被参数改动自动覆盖。

import { canWrite as canWriteNow } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';
import {
  apiGet,
  apiPost,
  apiDelete,
  apiBlob,
  uploadImage,
  downloadBlob,
  newRequestId,
} from '@/utils/workshop-api';
import {
  saveLocalImage,
  listLocalImages,
  getLocalFile,
  updateLocalMeta,
  deleteLocalImage,
} from '@/utils/workshop-db';
import { imageUrl, releaseImageUrl } from '@/utils/workshop-payload';
import {
  ORIENTAL_ACTIONS,
  IMAGE_SIZES,
  FULLBODY_SIZE,
  PORTRAIT_SIZE,
  createOrientalForm,
  buildOrientalPrompt,
  extractBracketDescriptions,
  charCount,
} from '@/utils/oriental-prompt';
// 手绘风格提示词库(261 种, 分类 A–G): 数据在 utils/handraw-styles.js
import {
  HANDRAW_GROUPS,
  HANDRAW_TOTAL,
  countByGroup,
  filterStyles,
  stylePhrase,
  styleThumbPath,
  buildStylePrompt,
} from '@/utils/handraw-prompt';

export default {
  data() {
    return {
      tabs: [
        { value: 'create', label: '创作' },
        { value: 'local', label: '本机图库' },
        { value: 'gallery', label: '部落图库' },
      ],

      templates: [
        { name: '自由创作', prompt: '' },
        {
          name: '成员头像',
          prompt:
            '一位勇敢的部落守护者，精致铠甲，卡通游戏角色插画，半身头像，主体居中，背景简洁，适合圆形裁切，无文字。',
        },
        {
          name: '部落招新',
          prompt:
            '热闹的幻想部落村庄，宏伟城堡，飘扬的旗帜，温暖阳光，卡通游戏宣传插画，上方预留标题空间，无文字。',
        },
        {
          name: '荣誉背景',
          prompt:
            '金色王冠与盾牌，荣耀光芒，深蓝背景，精致卡通游戏插画，中间预留人物和文字空间，无文字。',
        },
        {
          name: '趣味小龙',
          prompt:
            '一只抱着金币睡觉的小龙，圆滚滚，可爱幽默，卡通插画，柔和光线，背景简洁，无文字。',
        },
      ],

      tab: 'create',
      config: null,
      prompt: '',
      // 最终提示词的来源: '' 空 | 'generated' 由设定生成 | 'manual' 用户自己写的。
      // 东方幻境里 "设定改了就必须重新整理提示词" 这条只管 generated;
      // 用户自己写的提示词不受设定改动影响(见 orientalNeedsApply)。
      promptSource: '',

      busy: false,
      pageError: '',
      taskError: '',
      taskText: '',

      pending: null,
      result: null,

      localItems: [],
      localLimit: 12,

      galleryItems: [],
      galleryPage: 1,
      galleryHasMore: false,

      thumbs: {},
      preview: null,

      // 创作模式: general(自由提示词/模板) | oriental(东方幻境)
      creationMode: 'general',
      orientalActions: ORIENTAL_ACTIONS,
      imageSizes: IMAGE_SIZES,
      orientalForm: createOrientalForm(),
      // 画面尺寸(两种模式共用)
      selectedSize: '1024x1024',
      // 用户是否手动选过尺寸: 选过就不再被"构图"自动覆盖
      sizePinned: false,
      orientalSource: '',
      // 旧剧情(括号格式)导入区默认折叠, 减少页面长度
      showBracketImport: false,
      orientalConfigRevision: 0,
      orientalAppliedRevision: 0,

      // ---------- 风格提示词库(手绘风格, 数据见 utils/handraw-styles.js) ----------
      // 只做两件事: 填进本页提示词框, 或复制到其它 AI。
      styleLibraryOpen: false,
      styleKeyword: '',
      styleGroup: '',
      // 列表分批渲染(261 条一次全渲染在原生 App 上偏重)
      styleLimit: 30,
      styleGroups: HANDRAW_GROUPS,
      styleTotal: HANDRAW_TOTAL,
      // 复制反馈(uni.showToast 会被这个弹层挡住, 所以自己给看得见的反馈)
      styleCopied: '',
      styleCopiedText: '',
      styleCopyTimer: null,
      // 风格参考图的大图预览 + 加载失败的编号(缺图时隐藏)
      stylePreview: null,
      styleThumbBroken: {},

      active: false,
      pollTimer: null,
      polling: false,
      viewSequence: 0,
    };
  },

  computed: {
    localVisible() {
      return this.localItems.slice(0, this.localLimit);
    },

    pendingStorageKey() {
      return this.config ? `coc_ai_pending_${this.config.local_namespace}` : '';
    },

    // 参数改过但还没重新生成提示词
    // (用户自己在下方写了提示词就不算"未应用": 他的文字就是最终稿, 不该被设定卡住)
    orientalNeedsApply() {
      return (
        this.creationMode === 'oriental' &&
        this.orientalConfigRevision !== this.orientalAppliedRevision &&
        this.promptSource !== 'manual'
      );
    },

    // ---------- 风格提示词库 ----------
    // 分类按钮上的计数(按数据实时统计, 不手写)
    styleGroupTabs() {
      const counts = countByGroup();
      return this.styleGroups.map((group) => ({ ...group, count: counts[group.id] || 0 }));
    },

    // 当前分类 + 关键词命中的全部风格
    styleMatches() {
      return filterStyles({ group: this.styleGroup, keyword: this.styleKeyword });
    },

    // 实际渲染出来的部分(分批加载)
    styleVisible() {
      return this.styleMatches.slice(0, this.styleLimit);
    },

    styleMore() {
      return Math.max(0, this.styleMatches.length - this.styleVisible.length);
    },

    // 当前分类的完整名字(短名 + 编号区间)
    styleGroupName() {
      if (!this.styleGroup) return '全部风格 · A–G';
      const group = this.styleGroupTabs.find((item) => item.id === this.styleGroup);
      return group ? `${group.id} · ${group.short}（${group.from}–${group.to}）` : '';
    },

    // 额度文案: 管理员不限制(服务端回 daily_unlimited), 非管理员显示 x/10
    quotaText() {
      if (!this.config) return '';
      if (this.config.daily_unlimited) {
        return `今日已提交 ${this.config.daily_used} 次 · 管理员不限次数`;
      }
      return `今日已提交 ${this.config.daily_used} / ${this.config.daily_limit} 次`;
    },

    quotaExhausted() {
      if (!this.config) return false;
      return !this.config.daily_unlimited && this.config.daily_used >= this.config.daily_limit;
    },

    generateDisabled() {
      return (
        this.busy ||
        !this.prompt.trim() ||
        !this.config ||
        !this.config.enabled ||
        this.orientalNeedsApply ||
        this.quotaExhausted
      );
    },

    generateLabel() {
      if (!this.config || !this.config.enabled) return '生图服务尚未配置';
      if (this.quotaExhausted) return '今日次数已用完';
      return '开始生成';
    },

    // 图库页提示里追加的一段(非管理员才显示上传日限)
    uploadQuotaText() {
      if (!this.config || !this.config.can_create) return '';
      if (this.config.upload_unlimited) return ' · 今日可上传：不限';
      return ` · 今日可上传：${this.config.upload_used} / ${this.config.upload_limit} 张`;
    },
  },

  watch: {
    // 任何东方幻境参数变化都算一次"未应用"的改动
    orientalForm: {
      deep: true,
      handler() {
        this.orientalConfigRevision += 1;
      },
    },
    // 搜索词一变就回到第一批(不用挂在 input 的 @input 上:
    // 同一个 input 上 v-model + @input 在 App 端会互相打架, 表现为"打字打不进去")
    styleKeyword() {
      this.styleLimit = 30;
    },
  },

  onShow() {
    this.active = true;
    setBrowserTitle();
    this.initialize();
  },

  onHide() {
    this.active = false;
    this.stopPolling();
    this.viewSequence += 1;
  },

  onUnload() {
    this.active = false;
    this.stopPolling();
    this.clearThumbs();
    this.closePreview();
    if (this.result && this.result.url) releaseImageUrl(this.result.url);
  },

  methods: {
    // 供模板显示字数: 按码点计数, 与 maxlength 的直觉一致
    charCount(text) {
      return charCount(text);
    },

    toast(title) {
      uni.showToast({ title, icon: 'none', duration: 2500 });
    },

    confirm(title, content) {
      return new Promise((resolve) => {
        uni.showModal({
          title,
          content,
          success: (res) => resolve(Boolean(res.confirm)),
          fail: () => resolve(false),
        });
      });
    },

    async initialize() {
      this.pageError = '';
      try {
        const nextConfig = await apiGet('/config');
        if (!this.active) return;

        // 身份变了(例如换了角色登录): 清空所有与旧身份绑定的状态
        const changed =
          this.config && this.config.local_namespace !== nextConfig.local_namespace;
        if (changed) {
          this.pending = null;
          this.localItems = [];
          this.galleryItems = [];
          this.clearThumbs();
          this.closePreview();
          if (this.result && this.result.url) releaseImageUrl(this.result.url);
          this.result = null;
        }

        this.config = nextConfig;

        let stored = null;
        try {
          stored = uni.getStorageSync(this.pendingStorageKey);
        } catch (e) {
          stored = null;
        }

        this.pending = stored && typeof stored === 'object' ? stored : null;

        if (this.pending && this.config.can_create) {
          this.prompt = this.pending.prompt;
          if (this.pending.mode === 'oriental') this.creationMode = 'oriental';
          await this.resumeTask();
        }

        if (this.tab === 'local') await this.loadLocal();
        if (this.tab === 'gallery') await this.loadGallery();
      } catch (error) {
        this.pageError = error.message;
      }
    },

    async refreshConfig() {
      const next = await apiGet('/config');
      if (this.config && next.local_namespace === this.config.local_namespace) {
        this.config = next;
      }
    },

    async changeTab(value) {
      this.tab = value;
      this.pageError = '';
      if (value === 'local') await this.loadLocal();
      if (value === 'gallery') await this.loadGallery();
    },

    useTemplate(item) {
      if (this.pending || this.busy) return;
      this.prompt = item.prompt;
    },

    // ---------- 创作模式 ----------
    async switchCreationMode(mode) {
      if (this.pending || this.busy || mode === this.creationMode) return;

      if (this.prompt.trim()) {
        const confirmed = await this.confirm('切换创作模式', '切换后会清空当前提示词，是否继续？');
        if (!confirmed) return;
      }

      this.creationMode = mode;
      this.prompt = '';
      this.promptSource = '';

      if (mode === 'oriental') {
        // 强制用户先点一次「生成提示词」
        this.orientalAppliedRevision = -1;
      }
    },

    /**
     * 用户手动编辑最终提示词。
     * 东方幻境里这等于"我自己拿定主意了": 不再强制先点「整理提示词」,
     * 之后改动设定也不会再把他卡住(设定只是参考, 见 orientalNeedsApply)。
     */
    onPromptEdited() {
      this.promptSource = this.prompt.trim() ? 'manual' : '';
    },

    // ---------- 风格提示词库 ----------
    openStyleLibrary() {
      if (this.pending || this.busy) return;
      this.styleLibraryOpen = true;
    },

    closeStyleLibrary() {
      this.styleLibraryOpen = false;
      this.clearCopyFeedback();
    },

    pickStyleGroup(id) {
      // 再点一次同一分类 = 回到"全部"
      this.styleGroup = this.styleGroup === id ? '' : id;
      this.resetStyleList();
    },

    // 关键词/分类变了就回到第一批
    resetStyleList() {
      this.styleLimit = 30;
    },

    showMoreStyles() {
      this.styleLimit += 30;
    },

    // ---------- 风格参考图 ----------
    styleThumb(number) {
      return styleThumbPath(number);
    },

    // 缩略图没生成(没跑 tools/build-handraw-thumbs.mjs)时不显示破图
    onStyleThumbError(number) {
      this.styleThumbBroken = { ...this.styleThumbBroken, [number]: true };
    },

    previewStyle(item) {
      const url = this.styleThumb(item.number);
      if (!url || this.styleThumbBroken[item.number]) return;
      this.stylePreview = {
        url,
        number: item.number,
        name: item.name,
        reference: item.reference,
        group: item.group,
      };
    },

    closeStylePreview() {
      this.stylePreview = null;
    },

    /**
     * 填进本页提示词框。
     * 已经有内容就把画风追加在后面(工坊本来就建议"主体 + 风格 + 场景"),
     * 不覆盖用户自己写的主体描述。
     */
    useStylePrompt(style) {
      if (this.pending || this.busy) return;
      const phrase = stylePhrase(style);
      const current = this.prompt.trim();
      const merged =
        current && !current.includes(style.name) ? `${current}，${phrase}` : phrase;
      this.prompt = merged.slice(0, 1000);
      // 这是用户挑定的最终文字, 按"自己写的"处理(东方幻境不再要求重新整理)
      this.promptSource = 'manual';
      this.styleLibraryOpen = false;
      this.clearCopyFeedback();
      this.toast(`已填入风格 ${style.number}`);
    },

    clearCopyFeedback() {
      if (this.styleCopyTimer) {
        clearTimeout(this.styleCopyTimer);
        this.styleCopyTimer = null;
      }
      this.styleCopied = '';
      this.styleCopiedText = '';
    },

    // 复制成功/失败都写在弹层里(uni.showToast 的层级比这个弹层低, 会被挡住看不见)
    showCopyFeedback(number, text) {
      this.clearCopyFeedback();
      this.styleCopied = number;
      this.styleCopiedText = text;
      this.styleCopyTimer = setTimeout(() => {
        this.styleCopied = '';
        this.styleCopiedText = '';
        this.styleCopyTimer = null;
      }, 4000);
    },

    // 复制完整画风文案, 粘到别的 AI 里让它出提示词或出图
    copyStylePrompt(style) {
      const data = buildStylePrompt(style);
      if (typeof uni.setClipboardData !== 'function') {
        this.showCopyFeedback(style.number, `请长按下面的文字手动复制（${style.number}）`);
        return;
      }
      uni.setClipboardData({
        data,
        success: () => this.showCopyFeedback(style.number, `风格 ${style.number} 已复制到剪贴板，粘到其它 AI 就能用`),
        fail: () => this.showCopyFeedback(style.number, '复制失败，请长按文字手动复制'),
      });
    },

    setOrientalOption(field, value) {
      if (this.pending || this.busy) return;
      this.orientalForm[field] = value;

      // 选"完整全身"且用户没手动定过尺寸时, 自动切到竖图;
      // 切回半身时只要还处于自动状态也退回方图。
      if (field === 'composition' && !this.sizePinned) {
        this.selectedSize = value === 'fullbody' ? FULLBODY_SIZE : PORTRAIT_SIZE;
      }
    },

    chooseSize(size) {
      if (this.pending || this.busy) return;
      this.selectedSize = size;
      // 手动选过之后, 不再被"构图"按钮自动覆盖
      this.sizePinned = true;
    },

    selectOrientalAction(item) {
      if (this.pending || this.busy) return;
      this.orientalForm.action = item.value;
    },

    async importBracketAction() {
      if (this.pending || this.busy) return;

      const extracted = extractBracketDescriptions(this.orientalSource);
      if (!extracted) {
        this.toast('没有找到括号描述，请直接填写动作');
        return;
      }
      if (charCount(extracted) > 160) {
        this.toast('括号内容超过 160 字，请先精简');
        return;
      }

      const confirmed = await this.confirm(
        '导入括号描述',
        '只提取括号内文字，不能自动区分动作和环境。导入后请检查，并把环境内容移到环境栏。'
      );
      if (!confirmed) return;

      this.orientalForm.action = extracted;
    },

    async applyOrientalPrompt() {
      if (this.pending || this.busy) return;

      let output;
      try {
        output = buildOrientalPrompt(this.orientalForm);
      } catch (error) {
        this.toast(error.message);
        return;
      }

      if (this.prompt.trim()) {
        const confirmed = await this.confirm(
          '重新整理提示词',
          '将替换下方最终提示词，包括你手动修改的内容，是否继续？'
        );
        if (!confirmed) return;
      }

      this.prompt = output.prompt;
      this.promptSource = 'generated';
      this.orientalAppliedRevision = this.orientalConfigRevision;
      this.toast('提示词已生成，可继续手动调整');
    },

    // ---------- 任务编号持久化 ----------
    persistPending() {
      try {
        uni.setStorageSync(this.pendingStorageKey, this.pending);
        return true;
      } catch (e) {
        return false;
      }
    },

    clearPending() {
      try {
        if (this.pendingStorageKey) uni.removeStorageSync(this.pendingStorageKey);
      } catch (e) {
        /* ignore */
      }
      this.pending = null;
      this.stopPolling();
    },

    // ---------- 生成 ----------
    async generate() {
      if (this.busy || this.pending || !this.config || !this.config.can_create) return;

      if (this.creationMode === 'oriental' && this.orientalNeedsApply) {
        this.toast('设定有变更，请先点击「生成提示词」或「重新整理提示词」');
        return;
      }
      if (this.quotaExhausted) {
        this.toast(`今日生成次数已用完（每天 ${this.config.daily_limit} 次），请明天再来`);
        return;
      }
      if (!this.prompt.trim()) return;

      uni.hideKeyboard();
      this.taskError = '';

      this.pending = {
        client_token: newRequestId(),
        prompt: this.prompt.trim(),
        mode: this.creationMode,
        // 通用创作沿用服务器默认尺寸, 东方幻境用用户选的
        image_size: this.creationMode === 'oriental' ? this.selectedSize : '',
        jobId: null,
      };

      // 编号存不下来就宁可先不生成, 避免刷新后丢失幂等编号导致重复计费
      if (!this.persistPending()) {
        this.pending = null;
        this.taskError = '无法保存任务编号，请检查浏览器存储权限。';
        return;
      }

      await this.resumeTask();
    },

    async resumeTask() {
      if (!this.pending || this.busy || !this.active) return;

      this.busy = true;
      this.taskError = '';
      this.taskText = '正在确认任务…';

      try {
        if (!this.pending.jobId) {
          const job = await apiPost('/jobs', {
            client_token: this.pending.client_token,
            prompt: this.pending.prompt,
            image_size: this.pending.image_size || undefined,
          });
          this.pending = { ...this.pending, jobId: job.id };
          this.persistPending();
        }
        await this.checkTask();
      } catch (error) {
        this.taskError = error.message;
        // 明确的配额/参数拒绝: 没必要一直锁住输入
        // (409 / 5xx / 网络错误保留原请求, 以免丢掉已在服务端创建的任务)
        if (!this.pending || !this.pending.jobId) {
          if ([400, 403, 429, 503].includes(error.status)) this.clearPending();
        }
      } finally {
        this.busy = false;
        this.refreshConfig().catch(() => {});
      }
    },

    stopPolling() {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    },

    schedulePolling() {
      this.stopPolling();
      if (!this.active || !this.pending) return;

      this.pollTimer = setTimeout(() => {
        this.checkTask().catch((error) => {
          this.taskError = error.message;
        });
      }, 2500);
    },

    async checkTask() {
      if (!this.active || !this.pending || !this.pending.jobId || this.polling) return;

      this.polling = true;

      const jobId = this.pending.jobId;
      const namespace = this.config.local_namespace;
      const pendingSnapshot = { ...this.pending };

      try {
        const job = await apiGet(`/jobs/${jobId}`);

        // 期间页面隐藏 / 身份变化 / 任务已换 -> 丢弃这次结果
        if (
          !this.active ||
          !this.pending ||
          this.pending.jobId !== jobId ||
          this.config.local_namespace !== namespace
        ) {
          return;
        }

        const labels = {
          queued: '任务排队中…',
          running: 'AI 正在生成，请稍候…',
          succeeded: '图片生成完成，正在保存到本机…',
        };
        this.taskText = labels[job.status] || '正在处理…';

        if (job.status === 'queued' || job.status === 'running') {
          this.schedulePolling();
          return;
        }

        if (job.status === 'succeeded') {
          const blob = await apiBlob(`/jobs/${jobId}/image`);

          const meta = {
            id: `${namespace}_${jobId}`,
            namespace,
            jobId,
            prompt: pendingSnapshot.prompt,
            mode: pendingSnapshot.mode || 'general',
            model: job.model,
            createdAt: Date.now(),
            uploadToken: newRequestId(),
            serverId: null,
          };

          let saved = false;
          try {
            // 已存在则保留原上传关联与创建时间, 不覆盖
            const existing = await listLocalImages(namespace);
            const old = existing.find((item) => item.id === meta.id);
            if (old) {
              Object.assign(meta, old);
              saved = true;
            } else {
              await saveLocalImage(meta, blob);
              saved = true;
            }
          } catch (e) {
            this.taskError = '本机保存失败，可能空间不足。请立即下载或清理后重试保存。';
          }

          if (!this.active || this.config.local_namespace !== namespace) return;

          if (this.result && this.result.url) releaseImageUrl(this.result.url);
          // imageUrl 放在"保存到本机"之后: App 端保存会把临时文件搬到持久目录,
          // 载荷里的路径会被改写, 这里拿到的才是搬完之后的地址。
          this.result = { blob, meta, saved, url: await imageUrl(blob) };

          if (saved) this.clearPending();
          else this.stopPolling();

          this.refreshConfig().catch(() => {});
          return;
        }

        this.taskError =
          job.error ||
          (job.status === 'expired' ? '临时图片已过期，请检查本机图库。' : '生成未完成，请稍后核对。');
        this.clearPending();
      } finally {
        this.polling = false;
      }
    },

    async retryLocalSave() {
      if (!this.result || this.busy) return;

      this.busy = true;
      try {
        await saveLocalImage(this.result.meta, this.result.blob);
        this.result.saved = true;
        this.taskError = '';
        this.clearPending();
        this.toast('已保存到当前浏览器');
      } catch (e) {
        this.toast('本机保存失败，请先下载图片');
      } finally {
        this.busy = false;
      }
    },

    // ---------- 缩略图 / 预览 ----------
    clearThumbs() {
      Object.values(this.thumbs).forEach((url) => releaseImageUrl(url));
      this.thumbs = {};
    },

    async showPreview(payload) {
      this.closePreview();
      this.preview = { blob: payload, url: await imageUrl(payload) };
    },

    closePreview() {
      if (this.preview && this.preview.url) releaseImageUrl(this.preview.url);
      this.preview = null;
    },

    async previewResult() {
      if (this.result) await this.showPreview(this.result.blob);
    },

    // ---------- 本机图库 ----------
    async loadLocal() {
      if (!this.config) return;

      const sequence = ++this.viewSequence;
      const namespace = this.config.local_namespace;

      this.pageError = '';
      this.clearThumbs();

      try {
        const items = await listLocalImages(namespace);
        if (sequence !== this.viewSequence || !this.active) return;

        this.localItems = items;

        for (const item of this.localVisible) {
          const file = await getLocalFile(item.id);
          if (sequence !== this.viewSequence || !this.active) return;
          if (!file) continue;
          this.thumbs[item.id] = await imageUrl(file.thumbnail || file.blob);
        }
      } catch (error) {
        this.pageError = `读取本机图库失败：${error.message}`;
      }
    },

    async moreLocal() {
      this.localLimit += 12;
      await this.loadLocal();
    },

    async previewLocal(item) {
      try {
        const file = await getLocalFile(item.id);
        if (!file) throw new Error('本机图片不存在');
        await this.showPreview(file.blob);
      } catch (error) {
        this.toast(error.message);
      }
    },

    async downloadLocal(item) {
      try {
        const file = await getLocalFile(item.id);
        if (!file) throw new Error('本机图片不存在');
        this.download(file.blob);
      } catch (error) {
        this.toast(error.message);
      }
    },

    // 历史图片只保存了最终提示词, 没有保存模式表单:
    // 因此复用后回到「通用创作」, 避免把旧提示词和当前东方配置混在一起
    reusePrompt(item) {
      if (this.pending || this.busy) {
        this.toast('请先处理当前生成任务');
        return;
      }
      this.creationMode = 'general';
      this.prompt = item.prompt || '';
      this.tab = 'create';
      this.toast('提示词已填入，可直接修改或重新生成');
    },

    async removeLocal(item) {
      if (this.busy) return;

      const confirmed = await this.confirm(
        '删除本机图片',
        '只删除当前浏览器副本，不会删除服务器图片。确认继续？'
      );
      if (!confirmed) return;

      try {
        await deleteLocalImage(item.id);
        await this.loadLocal();
      } catch (error) {
        this.toast(error.message);
      }
    },

    // ---------- 部落图库 ----------
    async loadGallery() {
      if (!this.config) return;

      const sequence = ++this.viewSequence;
      this.pageError = '';
      this.clearThumbs();

      try {
        const data = await apiGet(`/gallery?page=${this.galleryPage}`);
        if (sequence !== this.viewSequence || !this.active) return;

        this.galleryItems = data.items;
        this.galleryHasMore = data.has_more;

        // 顺序加载缩略图, 避免手机同时请求大量图片
        for (const item of data.items) {
          const blob = await apiBlob(`/gallery/${item.id}/image?thumb=1`).catch(() => null);
          if (sequence !== this.viewSequence || !this.active) return;
          if (blob) this.thumbs[`server_${item.id}`] = await imageUrl(blob);
        }

        this.refreshConfig().catch(() => {});
      } catch (error) {
        this.pageError = error.message;
      }
    },

    async changeGalleryPage(delta) {
      this.galleryPage = Math.max(1, this.galleryPage + delta);
      await this.loadGallery();
    },

    async previewServer(item) {
      try {
        const blob = await apiBlob(`/gallery/${item.id}/image`);
        await this.showPreview(blob);
      } catch (error) {
        this.toast(error.message);
      }
    },

    async downloadServer(item) {
      try {
        const blob = await apiBlob(`/gallery/${item.id}/image`);
        this.download(blob);
      } catch (error) {
        this.toast(error.message);
      }
    },

    async removeServer(item) {
      if (this.busy) return;

      const confirmed = await this.confirm(
        '删除服务器图片',
        '删除后释放服务器配额，但不会删除其他设备已经下载的副本。确认继续？'
      );
      if (!confirmed) return;

      this.busy = true;
      try {
        await apiDelete(`/gallery/${item.id}`);

        // 本机若关联了这张图, 清掉"曾上传"标记并换新上传编号
        const local = await listLocalImages(this.config.local_namespace);
        for (const image of local) {
          if (image.serverId === item.id) {
            await updateLocalMeta(image.id, { serverId: null, uploadToken: newRequestId() });
          }
        }
        this.localItems = [];

        await this.loadGallery();
        await this.refreshConfig();
        this.toast('服务器图片已删除');
      } catch (error) {
        this.toast(error.message);
      } finally {
        this.busy = false;
      }
    },

    // ---------- 上传 ----------
    async uploadLocal(item) {
      if (this.busy || !this.config || !this.config.can_create) return;

      if (item.serverId) {
        const again = await this.confirm(
          '此图曾经上传',
          '如果服务器副本仍存在，不需要重复上传。是否先打开部落图库核对？'
        );
        if (again) await this.changeTab('gallery');
        return;
      }

      const confirmed = await this.confirm(
        '上传到部落图库',
        '上传后所有已登录用户均可查看。将占用服务器、当前 IP 和当前身份的图片名额；提示词不会上传。'
      );
      if (!confirmed) return;

      this.busy = true;
      try {
        const file = await getLocalFile(item.id);
        if (!file) throw new Error('本机图片不存在');

        const response = await uploadImage(file.blob, item.uploadToken);
        await updateLocalMeta(item.id, { serverId: response.id });

        // 同步内存里的列表项, 避免整表重读
        const target = this.localItems.find((row) => row.id === item.id);
        if (target) target.serverId = response.id;

        this.toast(response.duplicated ? '原上传已确认' : '上传成功');
        await this.refreshConfig();
      } catch (error) {
        if (error.status === 410) {
          // 服务器副本已被删除: 需要一个新的上传编号
          const reset = await this.confirm(
            '原上传已被删除',
            '是否准备一个新的上传编号？确认后需再次点击上传，不会立即上传。'
          );
          if (reset) {
            const uploadToken = newRequestId();
            await updateLocalMeta(item.id, { uploadToken, serverId: null });
            const target = this.localItems.find((row) => row.id === item.id);
            if (target) {
              target.uploadToken = uploadToken;
              target.serverId = null;
            }
          }
        } else {
          this.toast(error.message);
        }
      } finally {
        this.busy = false;
      }
    },

    // ---------- 下载 ----------
    // H5: 触发浏览器下载; App: 存进系统相册。提示文案由 workshop-api 按平台给出。
    async download(payload) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');

      try {
        const message = await downloadBlob(payload, `部落创作_${stamp}.webp`);
        if (message) this.toast(message);
      } catch (error) {
        this.toast(error.message);
      }
    },

    downloadResult() {
      if (this.result) this.download(this.result.blob);
    },

    downloadPreview() {
      if (this.preview) this.download(this.preview.blob);
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24rpx;
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
  background: #f5f6fb;
  color: #30364d;
}

button::after {
  border: none;
}

button {
  box-sizing: border-box;
}

button[disabled] {
  opacity: .48;
}

/* ---------- 顶部工作台 ---------- */
.heading {
  position: relative;
  overflow: hidden;
  padding: 34rpx 30rpx 30rpx;
  border-radius: 30rpx;
  background: linear-gradient(115deg, #363d82, #5958bd 65%, #7e72d7);
  box-shadow: 0 12rpx 34rpx rgba(62, 60, 130, .14);
}

.hero-orbit {
  position: absolute;
  top: -180rpx;
  right: -100rpx;
  width: 360rpx;
  height: 360rpx;
  border: 48rpx solid rgba(255, 255, 255, .055);
  border-radius: 50%;
  pointer-events: none;
}

.hero-main,
.hero-foot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-copy {
  min-width: 0;
}

.eyebrow {
  display: block;
  color: #d3d2fa;
  font-size: 18rpx;
  letter-spacing: 3rpx;
}

.title {
  display: block;
  margin-top: 15rpx;
  color: #fff;
  font-size: 43rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}

.subtitle {
  display: block;
  margin-top: 14rpx;
  color: #dfdef8;
  font-size: 22rpx;
  line-height: 1.7;
}

.hero-symbol {
  flex-shrink: 0;
  margin-left: 18rpx;
  color: #f9e4bd;
  font-size: 90rpx;
  line-height: 1;
  text-shadow: 0 0 32rpx rgba(255, 222, 161, .2);
}

.hero-foot {
  margin-top: 28rpx;
  padding-top: 22rpx;
  border-top: 2rpx solid rgba(255, 255, 255, .12);
}

.privacy-pill {
  display: flex;
  align-items: center;
  color: #e1e2ff;
  font-size: 20rpx;
}

.privacy-dot {
  width: 9rpx;
  height: 9rpx;
  margin-right: 9rpx;
  border-radius: 50%;
  background: #a9e7ce;
}

.hero-foot-note {
  margin-left: 12rpx;
  color: #d2ceed;
  font-size: 19rpx;
}

/* ---------- 主标签 ---------- */
.tabs {
  display: flex;
  gap: 8rpx;
  margin: 22rpx 0 30rpx;
  padding: 7rpx;
  border: 2rpx solid #fff;
  border-radius: 19rpx;
  background: #eaeaf5;
}

.tab {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 44px;
  margin: 0;
  padding: 12rpx 8rpx;
  border-radius: 13rpx;
  background: transparent;
  color: #85879d;
  font-size: 25rpx;
  line-height: 1.4;
}

.tab-symbol {
  margin-right: 9rpx;
  font-size: 26rpx;
}

.tab.active {
  background: #fff;
  color: #615bc1;
  font-weight: 700;
  box-shadow: 0 4rpx 12rpx rgba(63, 59, 116, .07);
}

/* ---------- 通用结构 ---------- */
.card {
  margin-bottom: 24rpx;
  padding: 28rpx;
  border: 2rpx solid #fff;
  border-radius: 25rpx;
  background: #fff;
  box-shadow: 0 8rpx 28rpx rgba(48, 53, 90, .035);
}

.section-heading,
.section-heading-left,
.heading-left,
.gallery-heading,
.label-row {
  display: flex;
  align-items: center;
}

.section-heading,
.gallery-heading,
.label-row {
  justify-content: space-between;
}

.section-heading {
  margin: 0 4rpx 20rpx;
}

.heading-mark {
  width: 6rpx;
  height: 26rpx;
  margin-right: 12rpx;
  border-radius: 6rpx;
  background: #7770ca;
}

.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.5;
}

.section-subtitle {
  display: block;
  margin-top: 7rpx;
  color: #9297aa;
  font-size: 21rpx;
  line-height: 1.7;
}

.label-row {
  gap: 16rpx;
  margin-bottom: 22rpx;
}

.label-row > view {
  min-width: 0;
}

.muted {
  flex-shrink: 0;
  margin-left: 12rpx;
  color: #959bb0;
  font-size: 20rpx;
}

.corner-symbol,
.prompt-symbol {
  flex-shrink: 0;
  color: #c1badf;
  font-size: 45rpx;
}

.description {
  display: block;
  margin-top: 15rpx;
  color: #8b92a6;
  font-size: 22rpx;
  line-height: 1.8;
}

/* ---------- 模式双卡 ---------- */
.mode-switch {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.mode-button {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  margin: 0;
  padding: 22rpx;
  border: 2rpx solid #e8e9f2;
  border-radius: 22rpx;
  background: #fff;
  color: #747c92;
  text-align: left;
  line-height: 1.5;
}

.mode-button.active {
  border-color: #b8b1ed;
  background: linear-gradient(135deg, #f5f2ff, #fff);
  box-shadow: 0 6rpx 20rpx rgba(100, 84, 173, .05);
}

.mode-button.oriental-mode.active {
  border-color: #b5cbc8;
  background: linear-gradient(135deg, #eef6f3, #fff);
}

.mode-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  margin-bottom: 15rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
}

.general-icon {
  background: #ece7fd;
  color: #8974c6;
}

.oriental-icon {
  background: #e6f0ed;
  color: #72978d;
  font-family: serif;
}

.mode-copy {
  display: flex;
  flex-direction: column;
}

.mode-title {
  color: #525772;
  font-size: 28rpx;
  font-weight: 700;
}

.mode-desc {
  margin-top: 5rpx;
  color: #9297aa;
  font-size: 19rpx;
}

.mode-radio {
  position: absolute;
  top: 24rpx;
  right: 22rpx;
  width: 20rpx;
  height: 20rpx;
  box-sizing: border-box;
  border: 2rpx solid #dce0ec;
  border-radius: 50%;
  background: #fff;
}

.mode-button.active .mode-radio {
  border: 6rpx solid #8b7ace;
}

.oriental-mode.active .mode-radio {
  border-color: #7caa9b;
}

/* ---------- 模板 ---------- */
.template-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.template-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 12rpx 18rpx;
  border: 2rpx solid #eeedf6;
  border-radius: 13rpx;
  background: #f9f9fd;
  color: #7a7d96;
  font-size: 23rpx;
  line-height: 1.4;
}

.template-button.selected {
  border-color: #d4ccf3;
  background: #f0ebfd;
  color: #7763b7;
}

.template-icon {
  margin-right: 10rpx;
  font-size: 26rpx;
}

/* ---------- 东方幻境 ---------- */
.oriental-header {
  position: relative;
  overflow: hidden;
  padding: 28rpx;
  border-radius: 18rpx;
  background: linear-gradient(115deg, #eef4f0, #f3eff8);
}

.oriental-eyebrow {
  display: block;
  color: #9aafa3;
  font-size: 17rpx;
  letter-spacing: 3rpx;
}

.oriental-title {
  display: block;
  margin-top: 10rpx;
  color: #607b71;
  font-family: serif;
  font-size: 37rpx;
  font-weight: 700;
  letter-spacing: 5rpx;
}

.oriental-description {
  display: block;
  margin-top: 12rpx;
  color: #8a9592;
  font-size: 22rpx;
  line-height: 1.8;
}

.form-section {
  margin-top: 28rpx;
  padding-top: 26rpx;
  border-top: 2rpx solid #f0f1f6;
}

.form-section-heading {
  display: flex;
  align-items: center;
  margin-bottom: 22rpx;
}

.step-number {
  margin-right: 12rpx;
  color: #b0a8c8;
  font-size: 25rpx;
  font-weight: 700;
  font-style: italic;
}

.form-section-title {
  color: #5c637d;
  font-size: 27rpx;
  font-weight: 700;
}

.field-label {
  display: block;
  margin: 22rpx 0 14rpx;
  color: #747b91;
  font-size: 24rpx;
  font-weight: 600;
}

.optional {
  margin-left: 8rpx;
  color: #aaaebe;
  font-size: 20rpx;
  font-weight: 400;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.choice-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 12rpx 22rpx;
  border: 2rpx solid #e9eaf2;
  border-radius: 12rpx;
  background: #fafbfe;
  color: #858ba1;
  font-size: 24rpx;
  line-height: 1.4;
}

.choice-button.active {
  border-color: #c7bddf;
  background: #f2edf9;
  color: #8470b0;
  font-weight: 600;
}

.oriental-textarea,
.oriental-input {
  width: 100%;
  box-sizing: border-box;
  padding: 20rpx;
  border: 2rpx solid #e8eaf2;
  border-radius: 14rpx;
  background: #fafbfe;
  color: #535d75;
  font-size: 25rpx;
  line-height: 1.8;
}

.oriental-textarea {
  height: 180rpx;
  margin-top: 16rpx;
}

.oriental-textarea.short {
  height: 150rpx;
}

.oriental-input {
  min-height: 44px;
  height: 88rpx;
  padding: 0 20rpx;
}

.field-count {
  display: block;
  margin-top: 8rpx;
  color: #a7aabd;
  font-size: 19rpx;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.bracket-import {
  overflow: hidden;
  margin-top: 28rpx;
  border: 2rpx dashed #e1dfeb;
  border-radius: 16rpx;
}

.import-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 20rpx;
  background: #faf9fd;
  text-align: left;
  line-height: 1.5;
}

.import-toggle-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.import-title {
  color: #827790;
  font-size: 24rpx;
}

.import-desc {
  margin-top: 6rpx;
  color: #a09aaa;
  font-size: 20rpx;
}

.import-arrow {
  margin-left: 16rpx;
  color: #a298b4;
  font-size: 32rpx;
}

.import-body {
  padding: 0 18rpx 18rpx;
}

.oriental-notice {
  display: block;
  margin-top: 14rpx;
  padding: 14rpx 18rpx;
  border-radius: 10rpx;
  background: #fff8e9;
  color: #b29052;
  font-size: 21rpx;
  line-height: 1.7;
}

/* ---------- 提示词 ---------- */
.prompt-shell {
  overflow: hidden;
  border: 2rpx solid #e4e3f2;
  border-radius: 18rpx;
  background: #fafaff;
}

.prompt-shell:focus-within {
  border-color: #b6aadd;
  box-shadow: 0 0 0 5rpx rgba(159, 139, 203, .07);
}

.prompt {
  display: block;
  width: 100%;
  height: 300rpx;
  box-sizing: border-box;
  padding: 22rpx;
  color: #535c75;
  font-size: 27rpx;
  line-height: 1.8;
}

.prompt-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 0 20rpx 18rpx;
  color: #a0a2b6;
  font-size: 19rpx;
}

.prompt-count {
  flex-shrink: 0;
  color: #9a8fba;
  font-variant-numeric: tabular-nums;
}

.info-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}

.parameter-chip {
  padding: 6rpx 12rpx;
  border-radius: 7rpx;
  background: #f0eef9;
  color: #8d80b6;
  font-size: 20rpx;
}

.model-name {
  color: #a0a4b5;
  font-size: 20rpx;
  overflow-wrap: anywhere;
}

.writing-tip {
  display: flex;
  align-items: flex-start;
  margin-top: 20rpx;
  color: #969baf;
  font-size: 21rpx;
  line-height: 1.8;
}

.tip-symbol {
  flex-shrink: 0;
  margin-right: 9rpx;
  color: #aaa3bd;
}

.generate-area {
  margin-top: 24rpx;
  padding-top: 22rpx;
  border-top: 2rpx solid #f0f1f7;
}

.quota-line {
  display: flex;
  align-items: center;
  color: #838a9f;
  font-size: 22rpx;
  line-height: 1.7;
}

.quota-dot {
  flex-shrink: 0;
  width: 10rpx;
  height: 10rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #74b79f;
}

.quota-dot.exhausted {
  background: #cfa369;
}

.save-hint {
  display: block;
  margin-top: 14rpx;
  color: #a0a5b5;
  font-size: 19rpx;
  line-height: 1.7;
  text-align: center;
}

/* ---------- 按钮与任务 ---------- */
.button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 18rpx 0 0;
  padding: 14rpx 20rpx;
  border-radius: 14rpx;
  background: #f0eef9;
  color: #8370b7;
  font-size: 25rpx;
  line-height: 1.5;
}

.button.primary {
  min-height: 48px;
  background: linear-gradient(110deg, #665ac0, #8671d3);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 9rpx 22rpx rgba(106, 86, 178, .16);
}

.button.primary[disabled] {
  background: #eae8f2;
  color: #a9a2bb;
  box-shadow: none;
  opacity: 1;
}

.button.oriental-apply {
  margin-top: 26rpx;
  background: linear-gradient(110deg, #ece6f7, #f3edf9);
  color: #8772b2;
  font-weight: 600;
}

.generate-button {
  font-size: 29rpx;
}

.generate-spark {
  margin-right: 12rpx;
  font-size: 30rpx;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.button-row .button {
  flex: 1;
  min-width: 120rpx;
  padding-right: 10rpx;
  padding-left: 10rpx;
  font-size: 23rpx;
}

.button.action-main {
  background: #eae4f9;
  color: #7a62ae;
  font-weight: 600;
}

.task-box {
  margin-top: 20rpx;
  padding: 22rpx;
  border: 2rpx solid #e7e2f5;
  border-radius: 17rpx;
  background: linear-gradient(120deg, #f5f2fd, #faf9ff);
}

.task-heading {
  display: flex;
  align-items: center;
}

.task-symbol {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 64rpx;
  height: 64rpx;
  margin-right: 16rpx;
  border-radius: 19rpx;
  background: #eae3fa;
  color: #9d83c8;
  font-size: 34rpx;
}

.task-copy {
  flex: 1;
  min-width: 0;
}

.task-title {
  display: block;
  color: #81709e;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.7;
}

.task-description {
  display: block;
  margin-top: 6rpx;
  color: #a297b2;
  font-size: 20rpx;
  line-height: 1.7;
}

.breathing {
  animation: studio-breathe 1.7s ease-in-out infinite;
}

@keyframes studio-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}

.error {
  display: block;
  margin-top: 18rpx;
  padding: 16rpx 18rpx;
  border-radius: 12rpx;
  background: #fff1f1;
  color: #c26b6b;
  font-size: 22rpx;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.page-error {
  margin-bottom: 20rpx;
}

/* ---------- 生成结果 ---------- */
.result-badge {
  flex-shrink: 0;
  padding: 6rpx 12rpx;
  border-radius: 8rpx;
  background: #f2eefb;
  color: #9a88bf;
  font-size: 19rpx;
}

.result-image {
  display: block;
  width: 100%;
  margin: 20rpx 0;
  border-radius: 17rpx;
  background: #f1f2f7;
}

.save-status {
  display: flex;
  align-items: flex-start;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background: #f0f8f3;
  color: #699b7e;
  font-size: 22rpx;
  line-height: 1.7;
}

.save-status.unsaved {
  background: #fff6e9;
  color: #b39158;
}

.save-status-icon {
  flex-shrink: 0;
  margin-right: 10rpx;
  font-weight: 700;
}

/* ---------- 图库说明和统计 ---------- */
.notice {
  display: flex;
  align-items: flex-start;
  margin-bottom: 24rpx;
  padding: 22rpx;
  border: 2rpx solid #f0e6d0;
  border-radius: 19rpx;
  background: #fff9ed;
  color: #ac9978;
  font-size: 21rpx;
  line-height: 1.8;
}

.notice-icon {
  flex-shrink: 0;
  margin-right: 16rpx;
  color: #c6a970;
  font-size: 35rpx;
  line-height: 1.4;
}

.notice-copy {
  flex: 1;
}

.notice-title {
  display: block;
  margin-bottom: 5rpx;
  color: #a18a61;
  font-size: 23rpx;
  font-weight: 600;
}

.gallery-heading {
  margin-bottom: 18rpx;
}

.count-badge {
  margin-left: 12rpx;
  padding: 5rpx 12rpx;
  border-radius: 8rpx;
  background: #eae8f6;
  color: #8b81b1;
  font-size: 20rpx;
}

.text-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 12rpx;
  background: transparent;
  color: #9182b8;
  font-size: 23rpx;
  line-height: 1.5;
}

.storage-stats {
  display: flex;
  padding: 22rpx 0;
  border-radius: 16rpx;
  background: #f7f6fc;
}

.storage-stat {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  border-right: 2rpx solid #eae7f3;
}

.storage-stat:last-child {
  border-right: none;
}

.stat-value {
  color: #7763a6;
  font-size: 31rpx;
  font-weight: 700;
}

.stat-limit {
  color: #aaa2bc;
  font-size: 21rpx;
}

.stat-label {
  margin-top: 8rpx;
  color: #9a94ab;
  font-size: 20rpx;
}

.upload-quota {
  display: block;
  margin-top: 17rpx;
  color: #a098b0;
  font-size: 20rpx;
  line-height: 1.7;
}

/* ---------- 双列作品卡 ---------- */
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 18rpx;
}

.image-card {
  overflow: hidden;
  width: calc((100% - 18rpx) / 2);
  box-sizing: border-box;
  border: 2rpx solid #fff;
  border-radius: 21rpx;
  background: #fff;
  box-shadow: 0 6rpx 20rpx rgba(53, 51, 88, .035);
}

.thumbnail-wrap {
  position: relative;
  overflow: hidden;
  background: #ececf4;
}

.thumbnail {
  display: block;
  width: 100%;
  height: 310rpx;
  background: linear-gradient(135deg, #efedf6, #e8edf5);
}

.image-overlay-tag {
  position: absolute;
  top: 14rpx;
  left: 14rpx;
  padding: 5rpx 11rpx;
  border: 1rpx solid rgba(255, 255, 255, .3);
  border-radius: 8rpx;
  background: rgba(40, 35, 60, .45);
  color: #fff;
  font-size: 18rpx;
}

.image-overlay-tag.mine {
  background: rgba(100, 75, 139, .72);
}

.image-view-hint {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 28rpx 14rpx 13rpx;
  background: linear-gradient(transparent, rgba(30, 27, 46, .4));
  color: rgba(255, 255, 255, .9);
  font-size: 18rpx;
  text-align: right;
}

.image-card-body {
  padding: 14rpx;
}

.image-caption {
  display: -webkit-box;
  overflow: hidden;
  min-height: 68rpx;
  margin: 0 4rpx 12rpx;
  color: #85899e;
  font-size: 22rpx;
  line-height: 1.55;
  word-break: break-all;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.server-caption {
  min-height: auto;
  white-space: nowrap;
  text-overflow: ellipsis;
  display: block;
}

.small-actions {
  display: flex;
  gap: 8rpx;
}

.small-actions button {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 4rpx;
  border-radius: 10rpx;
  background: #f4f1fb;
  color: #8c77b4;
  font-size: 21rpx;
  line-height: 1.4;
}

.secondary-actions {
  margin-top: 8rpx;
}

.secondary-actions button {
  background: #f8f9fc;
  color: #9095a9;
}

.small-actions button.tagged {
  color: #a3a7b7;
}

.small-actions button.danger {
  color: #c48888;
}

.load-more {
  margin-top: 24rpx;
  background: #eeedf6;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 24rpx;
}

.pagination .button {
  flex: 1;
  margin: 0;
}

.page-number {
  color: #9b93ae;
  font-size: 24rpx;
  font-variant-numeric: tabular-nums;
}

/* ---------- 加载 / 空状态 ---------- */
.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 52rpx 32rpx;
  text-align: center;
}

.state-illustration {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 110rpx;
  height: 110rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid #e8e2f5;
  border-radius: 34rpx;
  background: linear-gradient(135deg, #f1edfc, #f9f6ff);
  color: #ac98cf;
  font-size: 50rpx;
}

.state-title {
  color: #79718b;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.6;
}

.state-description {
  margin-top: 12rpx;
  color: #9c96a9;
  font-size: 23rpx;
  line-height: 1.9;
  overflow-wrap: anywhere;
}

.state-card .button {
  min-width: 260rpx;
  margin-top: 26rpx;
}

.gallery-empty {
  margin-top: 10rpx;
}

/* ---------- 风格提示词库入口 ---------- */
.style-entry-row {
  margin-top: 16rpx;
}

.style-entry {
  display: flex;
  align-items: center;
  min-height: 44px;
  margin: 0;
  padding: 14rpx 20rpx;
  border: 2rpx solid #ded6f4;
  border-radius: 14rpx;
  background: linear-gradient(135deg, #f6f2ff, #fdfbff);
  color: #6f5fae;
  font-size: 24rpx;
  line-height: 1.4;
}

.style-entry[disabled] {
  opacity: .55;
}

.style-entry-icon {
  margin-right: 10rpx;
  font-size: 26rpx;
}

.style-entry-title {
  flex-shrink: 0;
  font-weight: 600;
}

.style-entry-meta {
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(132, 112, 176, .12);
  color: #8470b0;
  font-size: 19rpx;
}

.style-entry-hint {
  display: block;
  margin-top: 10rpx;
  color: #a0a2b6;
  font-size: 19rpx;
  line-height: 1.7;
}

/* ---------- 风格提示词库弹层 ---------- */
.library-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  box-sizing: border-box;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background: rgba(20, 19, 31, .96);
}

.library-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  height: 88vh;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 24rpx;
  border-radius: 26rpx;
  background: #fff;
}

.library-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.library-heading {
  flex: 1;
  min-width: 0;
}

.library-title {
  display: block;
  color: #3f3a55;
  font-size: 30rpx;
  font-weight: 600;
}

.library-subtitle {
  display: block;
  margin-top: 6rpx;
  color: #9a94ad;
  font-size: 19rpx;
}

.library-close {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  background: #f3f2f9;
  color: #6f6a85;
  font-size: 40rpx;
  line-height: 1;
}

.library-field-label {
  display: block;
  flex-shrink: 0;
  margin-top: 20rpx;
  color: #7a7d96;
  font-size: 21rpx;
}

.library-input {
  flex-shrink: 0;
  width: 100%;
  /* 注意: uni-app 的 input 必须给显式高度 —— 内部那个真 <input> 是 height:100%,
     父级高度 auto 时会被算成 0, 结果"框看着在、点进去打不了字"(H5 实测 innerHeight=0)。 */
  height: 88rpx;
  box-sizing: border-box;
  margin-top: 10rpx;
  padding: 0 20rpx;
  border: 2rpx solid #e8eaf2;
  border-radius: 12rpx;
  background: #fafbfe;
  color: #535d75;
  font-size: 24rpx;
  line-height: 1.6;
}

.library-search {
  margin-top: 12rpx;
}

.library-tabs {
  flex-shrink: 0;
  width: 100%;
  margin-top: 16rpx;
  white-space: nowrap;
}

.library-tab {
  display: inline-block;
  margin-right: 10rpx;
  padding: 10rpx 18rpx;
  border: 2rpx solid #eeedf6;
  border-radius: 999rpx;
  background: #f9f9fd;
  color: #7a7d96;
  font-size: 22rpx;
}

/* 分类字母做成小角标(分类名本身用两个代表子风格的关键词) */
.library-tab-id {
  margin-right: 8rpx;
  color: #a9a2c4;
  font-size: 19rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
}

.library-tab.active .library-tab-id {
  color: #8470b0;
}

.library-tab.active {
  border-color: #d4ccf3;
  background: #f0ebfd;
  color: #7763b7;
  font-weight: 600;
}

.library-group-name {
  display: block;
  flex-shrink: 0;
  margin-top: 14rpx;
  color: #6f6a85;
  font-size: 22rpx;
}

.library-list {
  flex: 1;
  min-height: 0;
  margin-top: 12rpx;
}

/* 复制反馈: 弹层比 uni.showToast 层级高, 所以反馈就写在弹层里 */
.library-status {
  display: block;
  flex-shrink: 0;
  margin-top: 12rpx;
  padding: 12rpx 18rpx;
  border-radius: 12rpx;
  background: #eef7f0;
  color: #3f7a51;
  font-size: 21rpx;
  line-height: 1.5;
}

.library-item {
  margin-bottom: 14rpx;
  padding: 20rpx;
  border: 2rpx solid #eeedf6;
  border-radius: 16rpx;
  background: #fbfaff;
}

.library-item-main {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
}

.library-thumb-box {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 150rpx;
  height: 150rpx;
  overflow: hidden;
  border: 2rpx solid #eceaf6;
  border-radius: 14rpx;
  background: #f4f2fb;
}

.library-thumb {
  width: 100%;
  height: 100%;
}

.library-thumb-fallback {
  color: #b3aecd;
  font-size: 30rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.library-item-text {
  flex: 1;
  min-width: 0;
}

.library-item-head {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.library-number {
  flex-shrink: 0;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: #efe9fb;
  color: #7a63bb;
  font-size: 21rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.library-name {
  flex: 1;
  min-width: 0;
  color: #45405c;
  font-size: 25rpx;
  font-weight: 600;
  line-height: 1.5;
}

.library-reference {
  display: block;
  margin-top: 8rpx;
  color: #9a94ad;
  font-size: 20rpx;
}

.library-traits {
  display: block;
  margin-top: 8rpx;
  color: #6c7086;
  font-size: 21rpx;
  line-height: 1.75;
}

.library-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
}

.library-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 10rpx 22rpx;
  border: 2rpx solid #e4e3f2;
  border-radius: 12rpx;
  background: #fff;
  color: #7a7d96;
  font-size: 22rpx;
  line-height: 1.4;
}

.library-action.primary {
  border-color: #cfc3ea;
  background: #f2edf9;
  color: #7763b7;
  font-weight: 600;
}

.library-action.primary.copied {
  border-color: #a9d3b6;
  background: #eaf7ee;
  color: #3f7a51;
}

.library-more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 6rpx 0 16rpx;
  padding: 12rpx;
  border: 2rpx dashed #ded6f4;
  border-radius: 14rpx;
  background: #fbfaff;
  color: #8470b0;
  font-size: 22rpx;
  line-height: 1.4;
}

.library-empty {
  padding: 40rpx 0;
  color: #a0a2b6;
  font-size: 22rpx;
  text-align: center;
}

.library-foot {
  display: block;
  flex-shrink: 0;
  margin-top: 14rpx;
  color: #a0a2b6;
  font-size: 19rpx;
  line-height: 1.7;
}

/* ---------- 风格参考图大图 ---------- */
.style-viewer {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 32rpx;
  background: rgba(20, 19, 31, .96);
}

.style-viewer-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 760px;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 24rpx;
  border-radius: 22rpx;
  background: #fff;
}

.style-viewer-image {
  width: 100%;
  border-radius: 16rpx;
  background: #f4f2fb;
}

.style-viewer-meta {
  margin-top: 18rpx;
}

.style-viewer-title {
  display: block;
  color: #3f3a55;
  font-size: 27rpx;
  font-weight: 600;
}

.style-viewer-sub {
  display: block;
  margin-top: 6rpx;
  color: #9a94ad;
  font-size: 20rpx;
}

.style-viewer-close {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 20rpx 0 0;
  padding: 12rpx;
  border: 2rpx solid #e4e3f2;
  border-radius: 12rpx;
  background: #fafbfe;
  color: #7a7d96;
  font-size: 24rpx;
  line-height: 1.4;
}

/* ---------- 全屏预览 ---------- */
.preview-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24rpx;
  padding-top: calc(24rpx + env(safe-area-inset-top));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background: rgba(20, 19, 31, .96);
}

.preview-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  max-height: 100%;
  min-height: 0;
}

.preview-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22rpx;
}

.preview-title {
  display: block;
  color: #f1edf8;
  font-size: 29rpx;
  font-weight: 600;
}

.preview-subtitle {
  display: block;
  margin-top: 6rpx;
  color: #8d829f;
  font-size: 17rpx;
  letter-spacing: 3rpx;
}

.preview-close {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, .07);
  color: #d8d0e5;
  font-size: 42rpx;
  line-height: 1;
}

.preview-scroll {
  flex-shrink: 1;
  min-height: 0;
  height: 62vh;
  overflow: hidden;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, .025);
}

.preview-image {
  display: block;
  width: 100%;
}

.preview-actions {
  display: flex;
  flex-shrink: 0;
  gap: 14rpx;
  margin-top: 22rpx;
}

.preview-actions button {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin: 0;
  padding: 14rpx;
  border-radius: 14rpx;
  font-size: 25rpx;
  line-height: 1.5;
}

.preview-actions .preview-download {
  background: #c5b4e2;
  color: #433355;
  font-weight: 700;
}

.preview-actions .preview-back {
  background: #33303e;
  color: #d3c8e2;
}

.preview-tip {
  display: block;
  flex-shrink: 0;
  margin-top: 16rpx;
  color: #a69ab7;
  font-size: 21rpx;
  line-height: 1.8;
  text-align: center;
}

/* ---------- 页脚 ---------- */
.footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
  margin-top: 32rpx;
  padding: 10rpx 0;
  color: #aaa5b8;
  font-size: 20rpx;
}

/* H5 宽屏不把表单无限拉宽 */
@media screen and (min-width: 768px) {
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 28px;
  }

  .image-card {
    width: calc((100% - 36rpx) / 3);
  }

  .thumbnail {
    height: 240px;
  }

  .prompt {
    height: 220px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .breathing {
    animation: none;
  }
}
</style>
