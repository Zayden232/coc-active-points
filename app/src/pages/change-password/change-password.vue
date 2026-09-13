<template>
  <view class="page">
    <view class="card">
      <text class="title">修改密码</text>

      <text v-if="force" class="notice">
        首次登录（或密码被重置后）必须先修改密码，之后才能使用业务功能。
      </text>

      <view class="field">
        <text class="label">原密码</text>
        <input class="input" v-model="oldPassword" :password="!show" placeholder="当前密码" />
      </view>
      <view class="field">
        <text class="label">新密码</text>
        <input class="input" v-model="newPassword" :password="!show" placeholder="至少 8 位" />
      </view>
      <view class="field">
        <text class="label">确认新密码</text>
        <input class="input" v-model="confirmPassword" :password="!show" placeholder="再输入一次" />
      </view>

      <view class="row">
        <text class="row-label">显示密码</text>
        <switch :checked="show" color="#5078f5" @change="show = $event.detail.value" />
      </view>

      <button class="btn" :disabled="saving" @click="submit">
        {{ saving ? '提交中…' : '保存并重新登录' }}
      </button>

      <text class="hint">
        修改成功后，这台手机和其它设备上的旧登录都会立即失效，需要用新密码重新登录。
      </text>
    </view>

    <text class="foot">忘记密码请联系超级管理员在服务器上重置</text>
  </view>
</template>

<script>
import { post, getToken, getUser, clearAuth, goLogin } from '@/utils/api';
import { setBrowserTitle } from '@/utils/h5';

export default {
  data() {
    return {
      force: false,
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
      show: false,
      saving: false,
      user: null,
    };
  },
  onLoad(options) {
    this.force = !!(options && String(options.force) === '1');
  },
  onShow() {
    setBrowserTitle();
    if (!getToken()) {
      goLogin('请先登录');
      return;
    }
    this.user = getUser();
  },
  methods: {
    async submit() {
      if (this.saving) return;
      if (!this.oldPassword) return uni.showToast({ title: '请输入原密码', icon: 'none' });
      if (!this.newPassword || this.newPassword.length < 8) {
        return uni.showToast({ title: '新密码至少 8 位', icon: 'none' });
      }
      if (this.newPassword !== this.confirmPassword) {
        return uni.showToast({ title: '两次输入的新密码不一致', icon: 'none' });
      }
      if (this.newPassword === this.oldPassword) {
        return uni.showToast({ title: '新密码不能与原密码相同', icon: 'none' });
      }

      this.saving = true;
      try {
        await post('/auth/change-password', {
          old_password: this.oldPassword,
          new_password: this.newPassword,
        });
        clearAuth();
        uni.showToast({ title: '密码已修改，请重新登录', icon: 'none', duration: 2200 });
        setTimeout(() => uni.reLaunch({ url: '/pages/login/login' }), 1600);
      } catch (e) {
        uni.showToast({ title: e.message || '修改失败', icon: 'none', duration: 2500 });
      } finally {
        this.saving = false;
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
.card {
  padding: 30rpx;
  border-radius: 20rpx;
  background: #fff;
}
.title {
  display: block;
  margin-bottom: 12rpx;
  color: #22304a;
  font-size: 34rpx;
  font-weight: 700;
}
.notice {
  display: block;
  margin-bottom: 22rpx;
  padding: 16rpx 18rpx;
  border-radius: 12rpx;
  background: #fff6e6;
  color: #a9743a;
  font-size: 24rpx;
  line-height: 1.7;
}
.field {
  margin-bottom: 22rpx;
}
.label {
  display: block;
  margin-bottom: 12rpx;
  color: #5b6880;
  font-size: 25rpx;
  font-weight: 600;
}
.input {
  height: 92rpx;
  padding: 0 22rpx;
  border: 2rpx solid #e6ebf5;
  border-radius: 16rpx;
  background: #f8faff;
  color: #24314a;
  font-size: 28rpx;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6rpx 0 4rpx;
}
.row-label {
  color: #5b6880;
  font-size: 26rpx;
}
.btn {
  height: 96rpx;
  margin-top: 24rpx;
  border-radius: 18rpx;
  background: linear-gradient(110deg, #5078f5, #655be8);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 96rpx;
}
.hint {
  display: block;
  margin-top: 20rpx;
  color: #98a3b8;
  font-size: 23rpx;
  line-height: 1.7;
}
.foot {
  display: block;
  margin-top: 26rpx;
  text-align: center;
  color: #a2adc0;
  font-size: 23rpx;
}
button::after {
  border: none;
}
</style>
