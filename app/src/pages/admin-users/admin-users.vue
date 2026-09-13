<template>
  <view class="page">
    <view class="hero">
      <view>
        <text class="hero-title">管理员管理</text>
        <text class="hero-desc">共 {{ users.length }} 个账号 · 只能存在 1 个超级管理员</text>
      </view>
      <text class="identity">{{ me ? me.role_text : '超级管理员' }}</text>
    </view>

    <!-- 一次性临时密码 -->
    <view v-if="tempPassword" class="card temp-card">
      <text class="temp-title">
        {{ tempUser }} 的临时密码（只显示这一次）
      </text>
      <!-- user-select: H5 上可以直接手动选中; 复制按钮走系统剪贴板(App 同样可用) -->
      <text class="temp-value" user-select>{{ tempPassword }}</text>
      <view class="temp-ops">
        <button class="temp-btn primary" @click="copyTemp">复制临时密码</button>
        <button class="temp-btn" @click="closeTemp">我已记下，关闭</button>
      </view>
      <text class="temp-hint">请通过可信渠道转交本人；对方首次登录必须修改密码。</text>
    </view>

    <!-- 新增管理员 -->
    <view class="card">
      <view class="section-head">
        <text class="section-title">新增管理员</text>
        <text v-if="creating" class="tag">提交中…</text>
      </view>
      <view class="row">
        <text class="row-label">用户名</text>
        <input class="row-input" v-model="form.username" placeholder="小写字母/数字/下划线" />
      </view>
      <view class="row">
        <text class="row-label">显示名称</text>
        <input class="row-input" v-model="form.display_name" placeholder="如：张三" />
      </view>
      <button class="btn" :disabled="creating" @click="createUser">
        {{ creating ? '创建中…' : '创建账号（系统生成临时密码）' }}
      </button>
    </view>

    <!-- 账号列表 -->
    <view class="card">
      <view class="section-head">
        <text class="section-title">账号列表</text>
        <button class="text-button" :disabled="loading" @click="load">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </view>

      <view v-for="u in users" :key="u.id" class="user-row" :class="{ disabled: !u.enabled }">
        <view class="user-main">
          <view class="user-line">
            <text class="user-name">{{ u.display_name || u.username }}</text>
            <text class="badge" :class="u.role === 'super_admin' ? 'badge-super' : 'badge-admin'">
              {{ u.role === 'super_admin' ? '超级管理员' : '管理员' }}
            </text>
            <text v-if="!u.enabled" class="badge badge-off">已停用</text>
            <text v-if="u.must_change_password" class="badge badge-warn">需改密</text>
          </view>
          <text class="user-sub">
            @{{ u.username }} · 最近登录 {{ u.last_login_at || '从未' }}
          </text>
        </view>

        <view class="user-ops">
          <text class="op" @click="editName(u)">改名</text>
          <text class="op" @click="resetPassword(u)">重置密码</text>
          <text class="op" @click="revoke(u)">强制退出</text>
          <text
            v-if="u.role !== 'super_admin'"
            class="op"
            :class="u.enabled ? 'danger' : ''"
            @click="toggleStatus(u)"
          >
            {{ u.enabled ? '停用' : '启用' }}
          </text>
          <text
            v-if="u.role !== 'super_admin'"
            class="op danger"
            @click="removeUser(u)"
          >
            删除
          </text>
        </view>
      </view>

      <view v-if="!users.length" class="empty">还没有账号数据</view>
    </view>

    <!-- 安全审计 -->
    <view class="card">
      <view class="section-head">
        <text class="section-title">安全审计（最近 {{ logs.length }} 条）</text>
        <button class="text-button" :disabled="loading" @click="loadLogs">刷新</button>
      </view>
      <view v-for="l in logs" :key="l.id" class="log-row">
        <text class="log-main">{{ l.created_at }} · {{ l.actor_username }} · {{ actionText(l.action) }}</text>
        <text v-if="l.details" class="log-sub">{{ l.details }}</text>
      </view>
      <view v-if="!logs.length" class="empty">暂无审计记录</view>
    </view>
  </view>
</template>

<script>
import { get, post, patch, del } from '@/utils/api';
import { ensureSuperAdminPage, roleText } from '@/utils/permissions';
import { setBrowserTitle } from '@/utils/h5';

const ACTION_TEXT = {
  login: '登录',
  create_admin: '创建管理员',
  update_display_name: '修改显示名',
  enable_admin: '启用账号',
  disable_admin: '停用账号',
  delete_user: '删除账号',
  reset_password: '重置密码',
  change_password: '修改密码',
  change_password_failed: '改密失败(原密码错)',
  logout_all: '退出所有设备',
  revoke_tokens: '强制退出',
  init_super_admin: '初始化超级管理员',
  cli_reset_password: '命令行重置密码',
};

export default {
  data() {
    return {
      users: [],
      logs: [],
      form: { username: '', display_name: '' },
      creating: false,
      loading: false,
      tempPassword: '',
      tempUser: '',
      me: null,
    };
  },
  onLoad() {
    if (!ensureSuperAdminPage()) return;
    this.me = { role_text: roleText() };
  },
  onShow() {
    setBrowserTitle();
    this.load();
    this.loadLogs();
  },
  methods: {
    actionText(a) {
      return ACTION_TEXT[a] || a;
    },
    toast(title) {
      uni.showToast({ title, icon: 'none', duration: 2600 });
    },
    confirm(title, content) {
      return new Promise((resolve) => {
        uni.showModal({
          title,
          content,
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false),
        });
      });
    },
    async load() {
      if (this.loading) return;
      this.loading = true;
      try {
        const list = await get('/admin/users');
        this.users = Array.isArray(list) ? list : [];
      } catch (e) {
        this.toast(e.message || '加载失败');
      } finally {
        this.loading = false;
      }
    },
    async loadLogs() {
      try {
        this.logs = await get('/admin/security-audit-logs?limit=20');
      } catch (e) {
        /* 审计加载失败不影响主流程 */
      }
    },
    // 一次性临时密码: 生成后置顶展示并提示复制(卡片在列表上方, 长列表里容易看不到)
    showTempPassword(username, password) {
      this.tempPassword = password || '';
      this.tempUser = username;
      if (this.tempPassword) {
        this.toast('已生成临时密码，请复制后转交本人');
        uni.pageScrollTo({ scrollTop: 0, duration: 200 });
      }
    },
    copyTemp() {
      if (!this.tempPassword) return;
      const done = () => this.toast('临时密码已复制');
      if (typeof uni.setClipboardData !== 'function') {
        this.toast('请长按上方密码手动复制');
        return;
      }
      uni.setClipboardData({
        data: this.tempPassword,
        success: done,
        fail: () => this.toast('复制失败，请长按密码手动复制'),
      });
    },
    closeTemp() {
      this.tempPassword = '';
      this.tempUser = '';
    },
    async createUser() {
      if (this.creating) return;
      const username = this.form.username.trim().toLowerCase();
      if (!username) return this.toast('请输入用户名');
      this.creating = true;
      try {
        const res = await post('/admin/users', {
          username,
          display_name: this.form.display_name.trim(),
        });
        this.showTempPassword(username, res.temp_password);
        this.form = { username: '', display_name: '' };
        await this.load();
        await this.loadLogs();
      } catch (e) {
        this.toast(e.message || '创建失败');
      } finally {
        this.creating = false;
      }
    },
    async editName(u) {
      const res = await new Promise((resolve) => {
        uni.showModal({
          title: '修改显示名称',
          editable: true,
          placeholderText: u.display_name || u.username,
          success: (r) => resolve(r),
          fail: () => resolve({ confirm: false }),
        });
      });
      if (!res.confirm) return;
      const displayName = String(res.content || '').trim();
      if (!displayName) return this.toast('显示名称不能为空');
      try {
        await patch(`/admin/users/${u.id}`, { display_name: displayName });
        this.toast('已更新');
        await this.load();
      } catch (e) {
        this.toast(e.message || '更新失败');
      }
    },
    async resetPassword(u) {
      const ok = await this.confirm(
        '重置密码',
        `将为「${u.display_name || u.username}」生成一次性临时密码，该账号所有设备会立即退出登录。继续？`
      );
      if (!ok) return;
      try {
        const res = await post(`/admin/users/${u.id}/reset-password`);
        this.showTempPassword(u.username, res.temp_password);
        await this.load();
        await this.loadLogs();
      } catch (e) {
        this.toast(e.message || '重置失败');
      }
    },
    async toggleStatus(u) {
      const next = !u.enabled;
      const ok = await this.confirm(
        next ? '启用账号' : '停用账号',
        next
          ? `启用「${u.username}」？对方需要用原密码重新登录。`
          : `停用「${u.username}」？该账号所有设备会立即退出，且旧登录不会恢复。`
      );
      if (!ok) return;
      try {
        await patch(`/admin/users/${u.id}/status`, { enabled: next });
        this.toast(next ? '已启用' : '已停用');
        await this.load();
        await this.loadLogs();
      } catch (e) {
        this.toast(e.message || '操作失败');
      }
    },
    async revoke(u) {
      const ok = await this.confirm('强制退出', `让「${u.username}」的所有设备立即退出登录？`);
      if (!ok) return;
      try {
        await post(`/admin/users/${u.id}/revoke-tokens`);
        this.toast('已强制退出');
        await this.loadLogs();
      } catch (e) {
        this.toast(e.message || '操作失败');
      }
    },
    // 删除账号: 必须手工输入用户名确认(改名输入框同样用 editable 弹窗, 该平台已验证可用)
    async removeUser(u) {
      const res = await new Promise((resolve) => {
        uni.showModal({
          title: '删除账号',
          editable: true,
          placeholderText: u.username,
          content: `将永久删除「${u.display_name || u.username}」(@${u.username})，不可恢复。\n历史操作日志会保留该账号的用户名快照。\n请输入用户名确认删除：`,
          success: (r) => resolve(r),
          fail: () => resolve({ confirm: false }),
        });
      });
      if (!res.confirm) return;
      if (String(res.content || '').trim().toLowerCase() !== String(u.username).toLowerCase()) {
        return this.toast('输入的用户名不一致，已取消删除');
      }
      try {
        await del(`/admin/users/${u.id}`);
        this.toast('账号已删除');
        if (this.tempUser === u.username) this.closeTemp();
        await this.load();
        await this.loadLogs();
      } catch (e) {
        this.toast(e.message || '删除失败');
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
}
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 28rpx;
  border-radius: 20rpx;
  background: linear-gradient(120deg, #4f6ef0, #6a5cf0);
  color: #fff;
}
.hero-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
}
.hero-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  opacity: 0.86;
}
.identity {
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.22);
  font-size: 22rpx;
}
.card {
  margin-top: 22rpx;
  padding: 26rpx 28rpx;
  border-radius: 20rpx;
  background: #fff;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10rpx;
}
.section-title {
  color: #22304a;
  font-size: 30rpx;
  font-weight: 700;
}
.tag {
  color: #8b96ab;
  font-size: 22rpx;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 2rpx solid #f2f5fa;
}
.row-label {
  color: #5b6880;
  font-size: 27rpx;
}
.row-input {
  flex: 1;
  min-width: 0;
  text-align: right;
  color: #24314a;
  font-size: 27rpx;
}
.btn {
  height: 92rpx;
  margin-top: 22rpx;
  border-radius: 18rpx;
  background: linear-gradient(110deg, #5078f5, #655be8);
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 92rpx;
}
.temp-card {
  background: #fff8ec;
}
.temp-title {
  display: block;
  color: #a9743a;
  font-size: 26rpx;
  font-weight: 600;
}
.temp-value {
  display: block;
  margin: 14rpx 0 8rpx;
  padding: 16rpx 20rpx;
  border-radius: 12rpx;
  background: #fff;
  color: #22304a;
  font-family: monospace;
  font-size: 34rpx;
  letter-spacing: 2rpx;
  text-align: center;
  /* H5: 允许手动选中/长按复制(text 组件默认不可选) */
  -webkit-user-select: text;
  user-select: text;
}
.temp-ops {
  display: flex;
  gap: 16rpx;
  margin-top: 14rpx;
}
.temp-btn {
  flex: 1;
  height: 76rpx;
  margin: 0;
  padding: 0;
  border-radius: 14rpx;
  background: #fff;
  color: #5b6880;
  font-size: 25rpx;
  font-weight: 600;
  line-height: 76rpx;
}
.temp-btn.primary {
  background: linear-gradient(110deg, #5078f5, #655be8);
  color: #fff;
}
.temp-hint {
  display: block;
  margin-top: 12rpx;
  color: #a08a6c;
  font-size: 22rpx;
  line-height: 1.7;
}
.text-button {
  margin: 16rpx 0 0;
  padding: 0;
  height: 56rpx;
  line-height: 56rpx;
  background: transparent;
  color: #4f6ef0;
  font-size: 25rpx;
}
.user-row {
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f2f5fa;
}
.user-row.disabled {
  opacity: 0.6;
}
.user-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}
.user-name {
  color: #22304a;
  font-size: 29rpx;
  font-weight: 600;
}
.badge {
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
}
.badge-super {
  background: #ede9ff;
  color: #6a5cf0;
}
.badge-admin {
  background: #eaf0ff;
  color: #4f6ef0;
}
.badge-off {
  background: #f2f4f8;
  color: #8b96ab;
}
.badge-warn {
  background: #fff2dc;
  color: #b8792d;
}
.user-sub {
  display: block;
  margin-top: 8rpx;
  color: #98a3b8;
  font-size: 22rpx;
}
.user-ops {
  display: flex;
  flex-wrap: wrap;
  gap: 22rpx;
  margin-top: 12rpx;
}
.op {
  color: #4f6ef0;
  font-size: 25rpx;
}
.op.danger {
  color: #d05a63;
}
.log-row {
  padding: 14rpx 0;
  border-bottom: 2rpx solid #f2f5fa;
}
.log-main {
  display: block;
  color: #40506b;
  font-size: 24rpx;
}
.log-sub {
  display: block;
  margin-top: 6rpx;
  color: #98a3b8;
  font-size: 22rpx;
}
.empty {
  padding: 24rpx 0;
  text-align: center;
  color: #a2adc0;
  font-size: 24rpx;
}
button::after {
  border: none;
}
</style>
