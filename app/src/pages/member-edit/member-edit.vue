<template>
  <view class="edit-page">
    <view v-if="!authorized" class="panel">
      此页面仅管理员可用。
    </view>

    <block v-else>
      <view class="profile-card">
        <view class="profile-avatar">
          {{ form.nickname.trim().slice(0, 1) || '员' }}
        </view>
        <text class="profile-name">
          {{ form.nickname.trim() || (id ? '编辑成员' : '新增成员') }}
        </text>

        <MemberWarStatus
          :status="form.status"
          :red-days="displayRedDays"
        />

        <text v-if="statusChanged" class="draft-tip">
          状态尚未保存
        </text>
      </view>

      <view v-if="loading" class="panel empty">
        正在加载成员…
      </view>

      <view v-else-if="loadError" class="panel">
        <text class="warning-text">{{ loadError }}</text>
        <button class="button secondary" @click="loadMember">
          重新加载
        </button>
      </view>

      <block v-else-if="ready">
        <!-- 归档成员: 说明它为什么不在"在部落"里, 以及怎么恢复 -->
        <view v-if="archived" class="archived-panel">
          <text class="archived-title">该成员已归档</text>
          <text class="archived-desc">
            归档于 {{ archivedAt || '未知日期' }}，不占在部落名额，也不参与新录入。
            历史积分、结算和发奖记录都还在。
          </text>
          <text class="archived-desc">
            恢复方法：把下面的状态改成「绿牌 · 参战」或「红牌 · 休战」并保存即可。
          </text>
        </view>

        <view class="panel">
          <text class="panel-title">基本资料</text>

          <text class="field-label">游戏昵称 *</text>
          <input
            v-model="form.nickname"
            class="field-input"
            maxlength="50"
            :disabled="busy"
            placeholder="请输入游戏昵称"
          />

          <text class="field-label">大本营等级</text>
          <input
            v-model="form.town_hall"
            class="field-input"
            type="number"
            maxlength="3"
            :disabled="busy"
            placeholder="例如 17（识图导入会自动填）"
          />

          <text class="field-label">繁荣度</text>
          <input
            v-model="form.prosperity"
            class="field-input"
            type="number"
            maxlength="10"
            :disabled="busy"
            placeholder="例如 63（成员列表默认按它排行）"
          />
          <text class="help">
            这两项由识图导入自动填入，也可以手工改；都只要求整数，不设上限；繁荣度用于成员列表排行。
          </text>

          <text class="field-label">入部落日期</text>
          <view class="date-row">
            <picker
              mode="date"
              :value="form.join_date || today"
              :end="today"
              :disabled="busy"
              @change="form.join_date = $event.detail.value"
            >
              <view class="field-input date-value">
                {{ form.join_date || '点击选择日期' }}
              </view>
            </picker>

            <button
              class="clear-date"
              :disabled="busy || !form.join_date"
              @click="form.join_date = ''"
            >
              清空
            </button>
          </view>
        </view>

        <view class="panel">
          <text class="panel-title">参战状态</text>
          <text class="help">
            选择旗帜修改状态，保存后生效。
          </text>

          <view class="status-options">
            <button
              v-for="option in statuses"
              :key="option.value"
              class="status-option"
              :class="{ chosen: form.status === option.value }"
              :disabled="busy"
              @click="form.status = option.value"
            >
              <MemberWarStatus
                :status="option.value"
                :red-days="option.value === 1 ? 0 : null"
                compact
                icon-only
              />
              <text>{{ option.label }}</text>
            </button>
          </view>

          <view v-if="form.status === 1" class="status-notice">
            <text v-if="originalStatus !== 1">
              保存后开始新的红牌计时。
            </text>
            <text v-else-if="redDays === null">
              该成员没有可靠的红牌开始时间，需要通过专门的补录操作确认。
              普通保存不会擅自把今天当作开始时间。
            </text>
            <text v-else>
              已连续挂红牌 {{ redDays }} 天。
              修改昵称或备注不会重置计时。
            </text>
          </view>

          <view
            v-if="form.status === 1 && originalStatus === 1 && redDays > 15"
            class="status-notice overdue"
          >
            已超过 15 天，建议联系成员确认休战原因或近期参战安排。
          </view>

          <!-- 红牌开始时间补录(仅"当前红牌 + 开始时间未知"时出现)
               走独立接口 PUT /members/:id/red-since, 不改状态、不把今天当作开始时间 -->
          <view
            v-if="id && form.status === 1 && originalStatus === 1 && redDays === null"
            class="status-notice backfill"
          >
            <text class="help">补录红牌开始日期（写入审计日志，不会改动状态）：</text>
            <picker mode="date" :value="backfillDate" :end="today" @change="onBackfillDate">
              <view class="backfill-input">{{ backfillDate || '选择开始日期' }}</view>
            </picker>
            <button
              class="button secondary"
              :disabled="busy || !backfillDate"
              @click="backfillRedSince"
            >
              {{ task === 'backfill' ? '提交中…' : '补录开始日期' }}
            </button>
          </view>

          <view v-if="form.status === 2" class="status-notice">
            离开成员不参与新录入，历史积分和结算记录保留。
          </view>
        </view>

        <view class="panel">
          <text class="panel-title">管理备注</text>
          <textarea
            v-model="form.note"
            class="note-input"
            maxlength="1000"
            :disabled="busy"
            placeholder="例如：暂时休战、联赛安排、联系情况"
          />
          <text class="help">内部备注应只向管理员返回。</text>
        </view>

        <button
          class="button primary"
          :disabled="busy || !form.nickname.trim()"
          @click="save"
        >
          {{ task === 'save' ? '保存中…' : '保存成员资料' }}
        </button>

        <!-- 已经归档的成员不再显示"移除并归档"(避免无意义的重复操作) -->
        <view v-if="id && !archived" class="archive-panel">
          <text class="help">
            移除后成员进入归档，不再显示在当前管理列表；
            之后可在成员页的「归档」筛选里找到并恢复。
            历史积分、结算和发奖记录不删除。
          </text>
          <button
            class="button danger"
            :disabled="busy"
            @click="archive"
          >
            {{ task === 'archive' ? '处理中…' : '移除并归档此成员' }}
          </button>
        </view>

        <!-- 已归档成员: 归档按钮换成"永久删除"(仅超管, 双重确认) -->
        <view v-else-if="id && archived && superAdmin" class="purge-panel">
          <text class="purge-title">永久删除（不可恢复）</text>
          <text class="purge-desc">
            删除后 TA 的全部历史会一起消失：积分流水、结算快照、发奖记录、转盘记录、成员外观。
            如果只是想让人离开名单，用上面的状态改成「绿牌 · 参战」即可恢复，不必删除。
          </text>
          <button
            class="button purge-button"
            :disabled="busy"
            @click="purge"
          >
            {{ task === 'purge' ? '删除中…' : '永久删除此成员' }}
          </button>
        </view>
      </block>
    </block>
  </view>
</template>

<script>
import { get, post, put, del } from '@/utils/api';
import { ensureAdminPage } from '@/utils/permissions';
import { canWrite as canWriteNow, isSuperAdmin as isSuperAdminNow } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';
import MemberWarStatus from '@/components/MemberWarStatus.vue';

// 本页依赖的后端契约(状态与红牌计时一律由服务端决定):
//   GET  /api/members                     -> [{ id, nickname, tag, town_hall, prosperity,
//                                              join_date(YYYY-MM-DD), status,
//                                              red_since, red_days(仅红牌且已知开始时间), note, deleted_at }]
//                                            默认不含归档成员(include_archived=1 才返回)
//   POST /api/members                     -> 新增(status=1 时服务端记 red_since=今天)
//   PUT  /api/members/:id                 -> 改名/标签/大本营/繁荣度/入部时间/备注 + 状态; 红牌计时由服务端算
//   PUT  /api/members/:id/red-since       -> 仅为"当前红牌且时间未知"的成员补录 { red_since, reason }
//   POST /api/members/batch-action        -> { client_token, operation:'archive', member_ids } 归档(软删除)
// 归档不删除积分/结算/发奖记录; 归档成员默认不出现在成员列表的"在部落"里,
// 但可以在「归档」筛选里找到并点开本页查看/编辑 —— 把状态改为绿牌/红牌保存即恢复
// (服务端 PUT 时会对 status!==2 清空 deleted_at)。

export default {
  components: { MemberWarStatus },

  data() {
    const now = new Date();
    const localDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    return {
      authorized: false,
      active: false,
      id: null,
      ready: false,
      loading: false,
      task: '',
      loadError: '',
      requestId: 0,
      today: localDate,

      originalStatus: 0,
      redDays: null,
      archiveToken: null,
      backfillDate: '',
      archived: false,
      archivedAt: '',
      // 物理删除(?purge=1)仅超级管理员, 单独记一个标记
      superAdmin: false,

      statuses: [
        { value: 0, label: '绿牌 · 参战' },
        { value: 1, label: '红牌 · 休战' },
        { value: 2, label: '离开' },
      ],

      form: {
        nickname: '',
        tag: '',
        town_hall: '',
        prosperity: '',
        join_date: '',
        status: 0,
        note: '',
      },
    };
  },

  computed: {
    busy() {
      return this.loading || !!this.task;
    },

    statusChanged() {
      return this.form.status !== this.originalStatus;
    },

    displayRedDays() {
      return this.form.status === 1 && this.originalStatus === 1
        ? this.redDays
        : null;
    },
  },

  onLoad(options) {
    this.authorized = !!ensureAdminPage();
    if (!this.authorized) return;

    if (options?.id !== undefined) {
      const id = String(options.id);

      if (!/^[1-9]\d*$/.test(id)) {
        this.loadError = '成员编号无效';
        return;
      }

      this.id = id;
    } else {
      this.ready = true;
    }
  },

  onShow() {
    this.active = true;
    setBrowserTitle();

    this.authorized = canWriteNow();
    this.superAdmin = isSuperAdminNow();
    if (!this.authorized) return;

    uni.setNavigationBarTitle({
      title: this.id ? '编辑成员' : '新增成员',
    });

    if (this.id && !this.ready) this.loadMember();
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

    async loadMember() {
      if (!this.id || this.busy || !canWriteNow()) return;

      const requestId = ++this.requestId;
      this.loading = true;
      this.loadError = '';

      try {
        // 必须带 include_archived=1: 归档成员现在也能从成员列表点进来
        // (不带的话这里只会报"成员不存在或已被归档", 变成一个死链接)
        const list = await get('/members?include_archived=1');

        if (!Array.isArray(list)) {
          throw new Error('成员接口格式异常');
        }

        const member = list.find(
          (item) => String(item.id) === this.id
        );

        if (!member) {
          throw new Error('成员不存在');
        }

        if (
          !this.active ||
          requestId !== this.requestId ||
          !canWriteNow()
        ) return;

        // 归档只是软删除: 仍然可以查看和编辑, 把状态改成绿牌/红牌保存即恢复
        this.archived = !!member.deleted_at;
        this.archivedAt = this.archived ? String(member.deleted_at).slice(0, 10) : '';

        const status = Number(member.status);
        if (![0, 1, 2].includes(status)) {
          throw new Error('成员状态异常，请管理员检查');
        }

        this.originalStatus = status;

        this.redDays =
          member.red_days !== null &&
          member.red_days !== undefined &&
          Number.isInteger(Number(member.red_days)) &&
          Number(member.red_days) >= 0
            ? Number(member.red_days)
            : null;

        this.form = {
          nickname: String(member.nickname || ''),
          tag: String(member.tag || ''),
          town_hall: member.town_hall == null ? '' : String(member.town_hall),
          prosperity: member.prosperity == null ? '' : String(member.prosperity),
          // 要求后端 DATE 返回 YYYY-MM-DD，不在前端转换UTC日期。
          join_date: member.join_date || '',
          status,
          note: String(member.note || ''),
        };

        this.ready = true;
      } catch (error) {
        if (requestId === this.requestId && this.active) {
          this.loadError = error.message || '加载失败';
        }
      } finally {
        if (requestId === this.requestId) this.loading = false;
      }
    },

    async save() {
      if (this.busy || !this.ready || !canWriteNow()) return;

      const nickname = this.form.nickname.trim();
      if (!nickname) return this.toast('请填写昵称');

      if (![0, 1, 2].includes(this.form.status)) {
        return this.toast('请选择有效状态');
      }

      const tag = this.form.tag.trim().toUpperCase();

      // 大本营/繁荣度: 留空 = 不填(存 NULL); 填了必须是范围内的整数
      const thRaw = String(this.form.town_hall == null ? '' : this.form.town_hall).trim();
      const prRaw = String(this.form.prosperity == null ? '' : this.form.prosperity).trim();
      const townHall = thRaw === '' ? null : Number(thRaw);
      const prosperity = prRaw === '' ? null : Number(prRaw);

      if (townHall !== null && (!Number.isInteger(townHall) || townHall < 1)) {
        return this.toast('大本营等级需是不小于 1 的整数');
      }
      if (prosperity !== null && (!Number.isInteger(prosperity) || prosperity < 0)) {
        return this.toast('繁荣度需是不小于 0 的整数');
      }

      const payload = {
        nickname,
        tag: tag ? '#' + tag.replace(/^#+/, '') : '',
        town_hall: townHall,
        prosperity,
        join_date: this.form.join_date || null,
        status: this.form.status,
        note: this.form.note.trim(),
      };

      this.task = 'save';

      try {
        if (this.statusChanged && this.id) {
          const confirmed = await this.confirm(
            '确认修改状态',
            '状态变化可能开始或结束红牌计时，是否继续？'
          );

          if (!confirmed || !this.active || !canWriteNow()) return;
        }

        if (this.id) {
          await put(`/members/${encodeURIComponent(this.id)}`, payload);
        } else {
          await post('/members', payload);
        }

        if (!this.active || !canWriteNow()) return;

        this.toast('已保存');

        // 不用延时定时器，避免退出页面后继续触发导航。
        uni.navigateBack({
          fail: () => this.toast('已保存，请返回成员列表查看'),
        });
      } catch (error) {
        this.toast(
          `${error.message || '保存结果未确认'}，请先核对成员列表，避免重复新增`
        );
      } finally {
        this.task = '';
      }
    },

    // 红牌开始日期补录(历史成员): 独立接口, 不改状态
    onBackfillDate(e) {
      this.backfillDate = e.detail.value;
    },

    async backfillRedSince() {
      if (this.busy || !this.id || !this.backfillDate || !canWriteNow()) return;

      this.task = 'backfill';

      try {
        await put(`/members/${encodeURIComponent(this.id)}/red-since`, {
          red_since: this.backfillDate,
          reason: '编辑页补录红牌开始日期',
        });

        if (!this.active || !canWriteNow()) return;

        this.toast('已补录红牌开始日期');
        this.backfillDate = '';
        await this.loadMember();
      } catch (error) {
        this.toast(error.message || '补录失败');
      } finally {
        this.task = '';
      }
    },

    /**
     * 永久删除(物理删除, 不可逆) —— 仅超级管理员。
     * 后端 DELETE /api/members/:id?purge=1 是 `DELETE FROM members`, 而 5 张表对 members(id)
     * 都是 ON DELETE CASCADE → 该成员的积分流水/结算快照/发奖记录/转盘记录/外观会一起消失。
     * 所以: 只有超管可见 + 先查清会删掉多少条流水 + 两次确认。
     */
    async purge() {
      if (this.busy || !this.id || !canWriteNow()) return;

      if (!isSuperAdminNow()) {
        this.toast('仅超级管理员可永久删除成员');
        return;
      }

      let cost = 'TA 的全部积分流水';
      try {
        const res = await get(`/records?member_id=${encodeURIComponent(this.id)}&limit=1`);
        const total = res && Number(res.total);
        if (Number.isFinite(total)) cost = `${total} 条积分流水`;
      } catch (e) {
        /* 查不到条数不阻断, 用模糊说法 */
      }

      if (!this.active) return;

      const nickname = this.form.nickname.trim() || `#${this.id}`;

      this.task = 'purge';
      try {
        const first = await this.confirm(
          '永久删除成员',
          `将永久删除「${nickname}」，无法恢复。` +
            `同时会删掉 TA 的全部历史：${cost}，以及结算快照、发奖记录、转盘记录、成员外观。`
        );
        if (!first || !this.active) return;

        const second = await this.confirm(
          '最后一次确认',
          `真的要永久删除「${nickname}」吗？此操作不可撤销，也不能靠备份以外的任何方式找回。`
        );
        if (!second || !this.active) return;

        await del(`/members/${encodeURIComponent(this.id)}?purge=1`);

        if (!this.active) return;

        this.toast(`已永久删除「${nickname}」`);
        uni.navigateBack({
          fail: () => this.toast('已永久删除，请返回成员列表'),
        });
      } catch (error) {
        this.toast(error.message || '永久删除失败');
      } finally {
        this.task = '';
      }
    },

    async archive() {
      if (this.busy || !this.id || !canWriteNow()) return;

      this.task = 'archive';

      try {
        const confirmed = await this.confirm(
          '移除并归档成员',
          '该成员将不再出现在当前成员列表，历史积分、结算及发奖记录保留。确认继续？'
        );

        if (!confirmed || !this.active || !canWriteNow()) return;

        if (!this.archiveToken) {
          this.archiveToken =
            `archive_${Date.now().toString(36)}_${Math.random()
              .toString(36).slice(2)}`;
        }

        await post('/members/batch-action', {
          operation: 'archive',
          member_ids: [this.id],
          client_token: this.archiveToken,
        });

        if (!this.active || !canWriteNow()) return;

        uni.navigateBack({
          fail: () => this.toast('已归档，请返回成员列表'),
        });
      } catch (error) {
        this.toast(error.message || '归档结果未确认，请核对后重试');
      } finally {
        this.task = '';
      }
    },
  },
};
</script>

<style scoped>
.edit-page {
  min-height: 100vh;
  padding: 24rpx;
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  background: #f4f6fb;
  color: #34425a;
}
.profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34rpx 24rpx;
  margin-bottom: 22rpx;
  border-radius: 22rpx;
  background: linear-gradient(135deg, #edf1ff, #fff);
  border: 2rpx solid #e3e8f6;
}
.profile-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100rpx;
  height: 100rpx;
  border-radius: 28rpx;
  background: #6579df;
  color: #fff;
  font-size: 42rpx;
  font-weight: 700;
}
.profile-name {
  margin: 18rpx 0 14rpx;
  font-size: 34rpx;
  font-weight: 700;
  text-align: center;
}
.draft-tip {
  margin-top: 12rpx;
  color: #ae823e;
  font-size: 22rpx;
}
.panel {
  padding: 28rpx;
  margin-bottom: 22rpx;
  background: #fff;
  border-radius: 20rpx;
}
.panel-title {
  display: block;
  font-size: 29rpx;
  font-weight: 700;
}
.field-label {
  display: block;
  margin: 24rpx 0 12rpx;
  font-size: 25rpx;
  color: #7d899d;
}
.field-input {
  width: 100%;
  min-height: 46px;
  box-sizing: border-box;
  padding: 0 20rpx;
  border: 2rpx solid #e4e9f2;
  border-radius: 12rpx;
  background: #fafbfe;
  font-size: 28rpx;
}
.date-value {
  display: flex;
  align-items: center;
}
.date-row {
  display: flex;
  gap: 14rpx;
  align-items: center;
}
.date-row picker {
  flex: 1;
}
.clear-date {
  display: flex;
  align-items: center;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 14rpx;
  background: transparent;
  color: #8e99aa;
  font-size: 24rpx;
  line-height: 1.5;
}
.help {
  display: block;
  margin-top: 14rpx;
  color: #8d98aa;
  font-size: 23rpx;
  line-height: 1.7;
}
.status-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 20rpx;
}
.status-option {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12rpx;
  flex: 1;
  min-width: 130rpx;
  min-height: 70px;
  margin: 0;
  padding: 18rpx 10rpx;
  border: 2rpx solid #e8ecf3;
  border-radius: 14rpx;
  background: #fafbfd;
  color: #6c7b92;
  font-size: 23rpx;
  line-height: 1.5;
}
.status-option.chosen {
  border-color: #7588e3;
  background: #f0f3ff;
}
.status-notice {
  margin-top: 20rpx;
  padding: 18rpx;
  border-radius: 12rpx;
  background: #f5f7fc;
  color: #7e8aa0;
  font-size: 23rpx;
  line-height: 1.7;
}
.status-notice.overdue {
  background: #fff5e5;
  color: #af793c;
}
/* 红牌开始时间补录面板(本项目补充) */
.status-notice.backfill {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  background: #f3f7ff;
  color: #6b7c99;
}
.backfill-input {
  min-height: 44px;
  padding: 0 20rpx;
  line-height: 44px;
  border: 2rpx solid #d9e2f2;
  border-radius: 12rpx;
  background: #fff;
  color: #2f3b52;
  font-size: 27rpx;
}
.status-notice.backfill .button {
  margin-top: 0;
}
.note-input {
  width: 100%;
  height: 190rpx;
  margin-top: 20rpx;
  padding: 20rpx;
  box-sizing: border-box;
  border: 2rpx solid #e4e9f2;
  border-radius: 12rpx;
  background: #fafbfe;
  font-size: 27rpx;
}
.button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin: 20rpx 0 0;
  padding: 14rpx 20rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.5;
}
.primary { background: #5268df; color: #fff; }
.secondary { background: #eef2ff; color: #5268df; }
.danger { background: #fff1f2; color: #c66370; }
.archive-panel { margin-top: 28rpx; }
.warning-text { color: #b67735; }
/* 已归档提示卡: 与正常面板区分, 但不要红得像报错 */
.archived-panel {
  display: block;
  padding: 24rpx;
  margin-bottom: 20rpx;
  background: #eef2fb;
  border: 2rpx solid #d9e0f3;
  border-radius: 20rpx;
}
.archived-title {
  display: block;
  margin-bottom: 10rpx;
  color: #4a5a7d;
  font-size: 28rpx;
  font-weight: 600;
}
.archived-desc {
  display: block;
  color: #66748f;
  font-size: 22rpx;
  line-height: 1.6;
}
.archived-desc + .archived-desc { margin-top: 8rpx; }
/* 永久删除区: 红框强调不可逆, 与上面的归档提示卡明确区分 */
.purge-panel {
  display: block;
  padding: 24rpx;
  margin-top: 28rpx;
  background: #fff5f5;
  border: 2rpx solid #f3cfd4;
  border-radius: 20rpx;
}
.purge-title {
  display: block;
  margin-bottom: 10rpx;
  color: #b03a3a;
  font-size: 27rpx;
  font-weight: 600;
}
.purge-desc {
  display: block;
  margin-bottom: 20rpx;
  color: #96606a;
  font-size: 22rpx;
  line-height: 1.6;
}
.purge-button {
  color: #fff;
  background: #d9534f;
}
.empty { text-align: center; color: #95a0b2; }
button::after { border: none; }
button[disabled] { opacity: .5; }
</style>
