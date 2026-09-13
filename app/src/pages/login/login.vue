<template>
  <view class="login">
    <!-- 背景装饰 -->
    <view class="bg-orb orb-one"></view>
    <view class="bg-orb orb-two"></view>

    <view class="login-content">
      <!-- 品牌区域 -->
      <view class="brand">
        <view class="brand-tag">
          <view class="tag-dot"></view>
          <text>让每一份活跃，都有回响</text>
        </view>

        <view class="logo-wrap">
          <text class="logo">🏰</text>
        </view>

        <text class="title">部落活跃积分</text>
        <text class="sub">CLAN ACTIVITY POINTS</text>
        <text class="brand-desc">记录并肩作战的日常，见证部落的每一次成长</text>
      </view>

      <!-- 登录卡片 -->
      <view class="login-card">
        <view class="card-heading">
          <text class="card-title">管理员登录</text>
          <text class="card-desc">使用你的账号登录，管理部落积分与成员</text>
        </view>

        <view class="form">
          <text class="field-label">用户名</text>

          <view class="input-wrap" :class="{ 'is-focused': userFocused }">
            <view class="user-icon">
              <view class="user-head"></view>
              <view class="user-body"></view>
            </view>
            <input
              v-model="username"
              class="input"
              type="text"
              :disabled="loading"
              placeholder="请输入用户名"
              placeholder-class="input-placeholder"
              confirm-type="next"
              @focus="userFocused = true"
              @blur="userFocused = false"
            />
          </view>

          <text class="field-label">密码</text>

          <view
            class="input-wrap"
            :class="{ 'is-focused': passwordFocused }"
          >
            <view class="lock-icon">
              <view class="lock-shackle"></view>
              <view class="lock-body">
                <view class="lock-keyhole"></view>
              </view>
            </view>

            <input
              v-model="password"
              class="input"
              type="text"
              :password="!showPassword"
              :disabled="loading"
              placeholder="请输入密码"
              placeholder-class="input-placeholder"
              confirm-type="done"
              @focus="passwordFocused = true"
              @blur="passwordFocused = false"
              @confirm="doLogin"
            />

            <button
              class="visibility-btn"
              :disabled="loading"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </view>

          <button
            class="login-btn"
            :disabled="loading"
            :loading="loading"
            @click="doLogin"
          >
            <text>{{ loading ? '正在进入…' : '登录' }}</text>
            <text v-if="!loading" class="btn-arrow">→</text>
          </button>

          <button class="guest-btn" :disabled="loading" @click="browseAsGuest">
            <text>暂不登录，直接浏览 →</text>
          </button>
        </view>

        <!-- 已登录账号 -->
        <view v-if="currentUser" class="signed-in">
          <text class="signed-in-text">
            当前已登录：{{ currentUser.display_name || currentUser.username }}（{{ currentRoleText }}）
          </text>
          <button class="text-btn" :disabled="loading" @click="signOut">退出当前账号</button>
        </view>

        <view class="divider"></view>

        <!-- 身份说明 -->
        <view class="access-info">
          <view class="access-item">
            <view class="role-badge admin-badge">
              <text>管</text>
            </view>
            <view class="access-copy">
              <text class="access-title">管理员账号</text>
              <text class="access-desc">录入积分 · 管理成员与规则</text>
            </view>
          </view>

          <view class="access-item">
            <view class="role-badge viewer-badge">
              <text>访</text>
            </view>
            <view class="access-copy">
              <text class="access-title">访客浏览</text>
              <text class="access-desc">无需登录 · 首页榜单随便看</text>
            </view>
          </view>
        </view>
      </view>

      <view class="footer">
        <text class="footer-tip">账号由超级管理员创建；忘记密码请联系部落管理员重置</text>
        <view class="footer-brand">
          <view class="footer-line"></view>
          <text>凝聚每一份力量</text>
          <view class="footer-line"></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { post, setAuth, clearAuth, getUser, getRole, ROLE } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';

const ROLE_TEXT = {
  [ROLE.SUPER]: '超级管理员',
  [ROLE.ADMIN]: '管理员',
  [ROLE.VIEWER]: '访客',
};

export default {
  data() {
    return {
      username: '',
      password: '',
      loading: false,
      showPassword: false,
      userFocused: false,
      passwordFocused: false,
      currentUser: null,
      currentRoleText: '',
    };
  },

  onShow() {
    setBrowserTitle();
    this.currentUser = getUser();
    this.currentRoleText = ROLE_TEXT[getRole()] || '访客';
  },

  methods: {
    /** 登录成功后回到来源页(通常是设置页), 没有来源就回首页 */
    leaveLogin() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      if (pages && pages.length > 1) {
        uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) });
      } else {
        uni.switchTab({ url: '/pages/index/index' });
      }
    },

    browseAsGuest() {
      if (this.loading) return;
      this.leaveLogin();
    },

    signOut() {
      clearAuth();
      this.currentUser = null;
      this.currentRoleText = '访客';
      uni.showToast({ title: '已退出登录', icon: 'none' });
    },

    async doLogin() {
      // 防止按钮点击与键盘确认造成重复提交
      if (this.loading) return;

      const username = this.username.trim();
      if (!username) {
        return uni.showToast({ title: '请输入用户名', icon: 'none' });
      }
      if (!this.password) {
        return uni.showToast({ title: '请输入密码', icon: 'none' });
      }

      this.loading = true;

      try {
        const data = await post('/auth/login', {
          username,
          password: this.password,
        });

        setAuth(data.token, data.user || { username, role: data.role });

        if (data.user && data.user.must_change_password) {
          uni.showToast({ title: '请先修改初始密码', icon: 'none', duration: 2000 });
          setTimeout(() => {
            uni.redirectTo({ url: '/pages/change-password/change-password?force=1' });
          }, 800);
          return;
        }

        uni.showToast({ title: '登录成功', icon: 'success', duration: 1200 });
        setTimeout(() => this.leaveLogin(), 600);
      } catch (e) {
        uni.showToast({
          title: (e && e.message) || '登录失败，请稍后重试',
          icon: 'none',
        });
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.login {
  position: relative;
  min-height: 100vh;
  padding: 88rpx 40rpx 48rpx;
  padding-bottom: calc(48rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: linear-gradient(
    155deg,
    #edf3ff 0%,
    #f7f9ff 42%,
    #f8fafc 72%,
    #eef6ff 100%
  );
}

/* 柔和的背景光晕 */
.bg-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.orb-one {
  width: 680rpx;
  height: 680rpx;
  top: -260rpx;
  right: -260rpx;
  background: radial-gradient(
    circle,
    rgba(139, 167, 255, 0.25) 0%,
    rgba(139, 167, 255, 0) 70%
  );
}

.orb-two {
  width: 620rpx;
  height: 620rpx;
  bottom: -240rpx;
  left: -260rpx;
  background: radial-gradient(
    circle,
    rgba(117, 204, 240, 0.2) 0%,
    rgba(117, 204, 240, 0) 70%
  );
}

.login-content {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 48rpx;
  text-align: center;
}

.brand-tag {
  display: flex;
  align-items: center;
  padding: 12rpx 22rpx;
  margin-bottom: 32rpx;
  border: 1px solid rgba(79, 110, 222, 0.1);
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.7);
  color: #62759b;
  font-size: 21rpx;
  letter-spacing: 1rpx;
}

.tag-dot {
  width: 10rpx;
  height: 10rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background: #6c8bf5;
  box-shadow: 0 0 0 6rpx rgba(108, 139, 245, 0.1);
}

.logo-wrap {
  width: 140rpx;
  height: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid rgba(255, 255, 255, 0.95);
  border-radius: 42rpx;
  background: linear-gradient(145deg, #ffffff, #e8eeff);
  box-shadow:
    0 20rpx 48rpx rgba(66, 96, 180, 0.12),
    inset 0 2rpx 0 #ffffff;
}

.logo {
  font-size: 78rpx;
  line-height: 1.2;
}

.title {
  margin-top: 28rpx;
  color: #203052;
  font-size: 46rpx;
  font-weight: 800;
  letter-spacing: 3rpx;
}

.sub {
  margin-top: 12rpx;
  color: #8392af;
  font-size: 19rpx;
  font-weight: 500;
  letter-spacing: 4rpx;
}

.brand-desc {
  margin-top: 24rpx;
  color: #7c89a1;
  font-size: 23rpx;
  line-height: 1.8;
}

/* 主卡片 */
.login-card {
  padding: 44rpx 36rpx 36rpx;
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow:
    0 24rpx 70rpx rgba(41, 67, 125, 0.07),
    0 4rpx 12rpx rgba(41, 67, 125, 0.025);
}

.card-heading {
  display: flex;
  flex-direction: column;
  margin-bottom: 36rpx;
}

.card-title {
  color: #253450;
  font-size: 36rpx;
  font-weight: 700;
}

.card-desc {
  margin-top: 12rpx;
  color: #8893a7;
  font-size: 24rpx;
  line-height: 1.7;
}

.field-label {
  display: block;
  margin-bottom: 16rpx;
  color: #4b5872;
  font-size: 25rpx;
  font-weight: 600;
}

/* 用户名图标(与锁图标同一套线条风格) */
.user-icon {
  position: relative;
  flex-shrink: 0;
  width: 28rpx;
  height: 34rpx;
}
.user-head {
  position: absolute;
  top: 0;
  left: 6rpx;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #98a6c2;
}
.user-body {
  position: absolute;
  bottom: 0;
  left: 1rpx;
  width: 26rpx;
  height: 14rpx;
  border-radius: 13rpx 13rpx 4rpx 4rpx;
  background: #98a6c2;
}

/* 第二个字段(密码)与用户名之间留间距 */
.field-label + .input-wrap + .field-label {
  margin-top: 26rpx;
}

.guest-btn {
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 18rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  background: #f2f5fd;
  color: #5a6b8c;
  font-size: 27rpx;
  font-weight: 500;
  line-height: 1.5;
}

.signed-in {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 24rpx;
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: #f4f7ff;
}
.signed-in-text {
  flex: 1;
  color: #5c6b8a;
  font-size: 24rpx;
  line-height: 1.6;
}
.text-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 18rpx;
  height: 60rpx;
  line-height: 60rpx;
  border-radius: 12rpx;
  background: #ffffff;
  color: #d05a63;
  font-size: 24rpx;
}

.input-wrap {
  height: 100rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
  box-sizing: border-box;
  border: 2rpx solid #e8edf5;
  border-radius: 18rpx;
  background: #f8faff;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.input-wrap.is-focused {
  border-color: #7691f4;
  background: #ffffff;
  box-shadow: 0 0 0 7rpx rgba(83, 117, 238, 0.08);
}

.input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 18rpx;
  color: #283753;
  font-size: 27rpx;
}

.input-placeholder {
  color: #a0abc0;
  font-size: 25rpx;
}

/* CSS 绘制锁图标，无需图标库 */
.lock-icon {
  position: relative;
  flex-shrink: 0;
  width: 28rpx;
  height: 34rpx;
}

.lock-shackle {
  position: absolute;
  top: 0;
  left: 6rpx;
  width: 16rpx;
  height: 18rpx;
  box-sizing: border-box;
  border: 3rpx solid #97a5bf;
  border-bottom: none;
  border-radius: 12rpx 12rpx 0 0;
}

.lock-body {
  position: absolute;
  bottom: 0;
  width: 28rpx;
  height: 23rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5rpx;
  background: #97a5bf;
}

.lock-keyhole {
  width: 4rpx;
  height: 8rpx;
  border-radius: 4rpx;
  background: #f8faff;
}

.visibility-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 16rpx 0 16rpx 10rpx;
  background: transparent;
  color: #7385aa;
  font-size: 23rpx;
  line-height: 1.5;
}

.visibility-btn::after,
.login-btn::after {
  border: none;
}

.visibility-btn[disabled] {
  background: transparent;
  color: #a7b0c2;
}

.login-btn {
  height: 98rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 28rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  background: linear-gradient(110deg, #5078f5, #655be8);
  box-shadow: 0 12rpx 26rpx rgba(80, 104, 235, 0.22);
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 2rpx;
  transition: opacity 0.2s ease;
}

.login-btn:active {
  opacity: 0.88;
}

.login-btn[disabled] {
  background: linear-gradient(110deg, #8da6f5, #a29ced);
  box-shadow: none;
  color: #ffffff;
}

.btn-arrow {
  margin-left: 18rpx;
  font-size: 35rpx;
  font-weight: 400;
}

.divider {
  height: 1px;
  margin: 36rpx 0 28rpx;
  background: #eef1f7;
}

.access-info {
  display: flex;
  align-items: flex-start;
}

.access-item {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.access-item + .access-item {
  margin-left: 16rpx;
}

.role-badge {
  flex-shrink: 0;
  width: 54rpx;
  height: 54rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 14rpx;
  border-radius: 15rpx;
  font-size: 24rpx;
  font-weight: 600;
}

.admin-badge {
  background: #edf2ff;
  color: #5c7be5;
}

.viewer-badge {
  background: #edf8f5;
  color: #4e9b86;
}

.access-copy {
  display: flex;
  flex-direction: column;
}

.access-title {
  color: #53617b;
  font-size: 23rpx;
  font-weight: 500;
}

.access-desc {
  margin-top: 6rpx;
  color: #939eb1;
  font-size: 20rpx;
  line-height: 1.5;
}

.footer {
  margin-top: 30rpx;
  text-align: center;
}

.footer-tip {
  color: #8e9ab0;
  font-size: 22rpx;
}

.footer-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 36rpx;
  color: #a2adc0;
  font-size: 20rpx;
  letter-spacing: 3rpx;
}

.footer-line {
  width: 44rpx;
  height: 1px;
  margin: 0 18rpx;
  background: #dce3ef;
}

/* 桌面端避免 rpx 随屏幕放大导致布局过大 */
@media screen and (min-width: 768px) {
  .login {
    padding: 48px 24px;
  }

  .brand {
    margin-bottom: 28px;
  }

  .logo-wrap {
    width: 88px;
    height: 88px;
    border-radius: 26px;
  }

  .logo {
    font-size: 48px;
  }

  .title {
    font-size: 30px;
  }

  .login-card {
    padding: 30px;
    border-radius: 24px;
  }

  .input-wrap,
  .login-btn {
    height: 56px;
  }
}
</style>
