<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ChevronLeft, ChevronRight, Download, LogOut, Settings2, Globe } from '@lucide/vue';
import type { AppUser } from '../../services/authService';
import { apiUrl } from '../../services/appUrl';
import { QuarkStreamService } from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import TvPlaybackAuth from './TvPlaybackAuth.vue';
import ThemeSwitch from '../common/ThemeSwitch.vue';
import SiteSettingsPanel from './SiteSettingsPanel.vue';
import LibraryMaintenanceStatus from './LibraryMaintenanceStatus.vue';
import { androidInstalled, installAndroidApp } from '../../services/androidInstall';

const props = defineProps<{ user: AppUser }>();
const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'auth-updated'): void;
  (e: 'back'): void;
}>();

const toast = useToast();
const installUrl = apiUrl('/install/ios.mobileconfig');
const isAndroid = /Android/i.test(navigator.userAgent);
const installHint = ref('');
const installApp = async () => {
  installHint.value = '';
  if (await installAndroidApp() === 'unavailable') installHint.value = '在 Chrome 菜单中选择“添加到主屏幕”或“安装应用”。';
};
const credential = ref('');
const loadingStatus = ref(true);
const statusError = ref('');
const credentialError = ref('');
const libraryConnected = ref(false);
const playbackConnected = ref(false);
const directPlaybackConnected = ref(false);
const tvTokenExchangeOrigin = ref('');
const isSaving = ref(false);
const showCredentialForm = ref(false);
const advancedConfiguration = ref(false);
const siteConfiguration = ref(false), siteBusy = ref(false);
const authSection = ref<HTMLElement | null>(null);
const refreshStatus = async () => {
  loadingStatus.value = true;
  statusError.value = '';
  try {
    const status = await QuarkStreamService.getConfig();
    libraryConnected.value = status.libraryConfigured ?? status.isConfigured;
    playbackConnected.value = status.isAuthenticated;
    directPlaybackConnected.value = Boolean(status.advancedPlaybackConfigured);
    tvTokenExchangeOrigin.value = status.tvTokenExchangeOrigin || '未配置';
  } catch {
    statusError.value = '暂时无法读取服务状态，请检查网络后重试。';
  } finally {
    loadingStatus.value = false;
  }
};

const saveCredential = async () => {
  const value = credential.value.trim();
  if (!value || isSaving.value) {
    if (!value) toast.show('请输入有效的 Cookie 字符串', '!');
    return;
  }

  isSaving.value = true;
  credentialError.value = '';
  try {
    const result = await QuarkStreamService.saveConfig(value);
    if (!result.success) {
      credentialError.value = result.message;
      return;
    }
    credential.value = '';
    libraryConnected.value = result.status?.libraryConfigured ?? result.status?.isConfigured ?? true;
    playbackConnected.value = result.status?.isAuthenticated ?? true;
    showCredentialForm.value = false;
    toast.show('Cookie 已验证并保存', '✓', 2800);
    emit('auth-updated');
  } finally {
    isSaving.value = false;
  }
};

const openAdvanced = async () => {
  if (props.user.role !== 'admin') return;
  siteConfiguration.value = false; advancedConfiguration.value = true;
  await refreshStatus();
  if (props.user.role === 'admin' && !statusError.value && !libraryConnected.value) showCredentialForm.value = true;
};
const focusAuth = async () => {
  if (props.user.role !== 'admin') { toast.show('认证由管理员维护', '!'); return; }
  await openAdvanced();
  if (props.user.role === 'admin') showCredentialForm.value = true;
  await nextTick();
  authSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
const back = () => {
  if (siteBusy.value) return;
  if (siteConfiguration.value) siteConfiguration.value = false;
  else if (advancedConfiguration.value) { advancedConfiguration.value = false; credential.value = ''; showCredentialForm.value = false; }
  else emit('back');
};

defineExpose({ focusAuth, refreshStatus });
</script>

<template>
  <main class="account-page">
    <header class="page-heading">
      <button type="button" class="back-button" :disabled="siteBusy" :aria-label="advancedConfiguration || siteConfiguration ? '返回设置' : '返回上一页'" @click="back"><ChevronLeft aria-hidden="true" /></button>
      <h1>{{ siteConfiguration ? '站点设置' : advancedConfiguration ? '高级配置' : '设置' }}</h1>
    </header>
    <template v-if="!advancedConfiguration && !siteConfiguration">
      <section class="settings-section general-settings" aria-label="系统配置">
        <div class="theme-row"><span>主题</span><ThemeSwitch /></div>
        <button v-if="user.role === 'admin'" class="settings-row" type="button" @click="siteConfiguration = true"><Globe aria-hidden="true" /><span>站点设置</span><ChevronRight class="chevron" aria-hidden="true" /></button>
        <button v-if="user.role === 'admin'" class="settings-row" type="button" @click="openAdvanced"><Settings2 aria-hidden="true" /><span>高级配置</span><ChevronRight class="chevron" aria-hidden="true" /></button>
        <template v-if="isAndroid">
          <button v-if="!androidInstalled" class="settings-row" type="button" @click="installApp"><Download aria-hidden="true" /><span>安装到桌面</span><ChevronRight class="chevron" aria-hidden="true" /></button>
          <p v-if="installHint && !androidInstalled" class="install-hint" role="status">{{ installHint }}</p>
        </template>
        <a v-else class="settings-row ios-install-link" :href="installUrl"><Download aria-hidden="true" /><span>安装到桌面</span><ChevronRight class="chevron" aria-hidden="true" /></a>
      </section>
      <button type="button" class="logout-button" @click="emit('logout')"><LogOut aria-hidden="true" />退出登录</button>
    </template>
    <SiteSettingsPanel v-else-if="siteConfiguration && user.role === 'admin'" @busy="siteBusy = $event" />
    <section v-else-if="user.role === 'admin'" ref="authSection" class="settings-section auth-section" aria-labelledby="auth-title">
      <div class="section-title-row">
        <div>
          <h2 id="auth-title">网盘认证</h2>
        </div>
        <div class="status-pill" :class="{ ready: libraryConnected && playbackConnected && !statusError }">
          <span class="status-dot" aria-hidden="true"></span>
          {{ loadingStatus ? '检查中' : statusError ? '待重试' : (libraryConnected && playbackConnected ? '已连接' : '待认证') }}
        </div>
      </div>

      <div v-if="statusError" class="inline-feedback" role="alert"><p>{{ statusError }}</p><button type="button" :disabled="loadingStatus" @click="refreshStatus">重新检查</button></div>
      <template v-if="user.role === 'admin'">
        <div v-if="loadingStatus" class="credential-loading" role="status">
          <span class="status-spinner" aria-hidden="true"></span>
          正在加载认证设置
        </div>

        <button
          v-else-if="libraryConnected && !showCredentialForm"
          type="button"
          class="reconfigure-button"
          @click="showCredentialForm = true"
        >
          更新 Cookie
          <ChevronRight aria-hidden="true" />
        </button>

        <div v-else-if="!statusError" class="credential-editor">
          <form class="credential-form" @submit.prevent="saveCredential">
            <label for="playback-credential">Cookie 字符串</label>
            <textarea
              id="playback-credential"
              v-model="credential"
              rows="4"
              autocapitalize="none"
              autocomplete="off"
              spellcheck="false"
              placeholder="粘贴从已登录浏览器复制的完整 Cookie"
              :disabled="isSaving"
              :aria-invalid="!!credentialError"
              :aria-describedby="credentialError ? 'credential-error' : undefined"
              @input="credentialError = ''"
            ></textarea>
            <p v-if="credentialError" id="credential-error" class="inline-feedback" role="alert">{{ credentialError }}</p>
            <small class="credential-hint">凭证加密保存，不回显。</small>
            <div class="form-actions">
              <button v-if="libraryConnected" type="button" class="cancel-edit" :disabled="isSaving" @click="showCredentialForm = false; credential = ''">取消</button>
              <button type="submit" class="save-credential" :disabled="isSaving || !credential.trim()">
                <span v-if="isSaving" class="button-spinner" aria-hidden="true"></span>
                {{ isSaving ? '正在验证…' : (libraryConnected ? '确认更新' : '验证并保存') }}
              </button>
            </div>
          </form>
        </div>
      </template>

      <p v-else class="managed-hint">由管理员维护认证</p>
      <LibraryMaintenanceStatus />
      <TvPlaybackAuth
        v-if="user.role === 'admin' && !loadingStatus && !statusError"
        :connected="directPlaybackConnected"
        :exchange-origin="tvTokenExchangeOrigin"
        @confirmed="refreshStatus(); emit('auth-updated'); toast.show('直连认证已保存', '✓')"
      />
    </section>

  </main>
</template>

<style scoped>
.account-page { position: relative; z-index: 1; width: min(780px, 100%); height: var(--app-viewport-height); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scrollbar-gutter: stable; margin: 0 auto; padding: calc(32px + var(--safe-area-top)) 24px 70px; }
.account-page::-webkit-scrollbar { width: 8px; }
.account-page::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 8px; background: var(--text-tertiary); background-clip: padding-box; }
.page-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.page-heading h1 { font-size: 1.45rem; font-weight: 700; letter-spacing: -.02em; }
.back-button { display: grid; width: 44px; height: 44px; padding: 0; place-items: center; border: 0; border-radius: 50%; color: var(--text-secondary); background: transparent; transition: background .15s, color .15s; }
.back-button:hover, .back-button:active { color: var(--text-primary); background: var(--glass-bg); }
.back-button svg { width: 22px; height: 22px; }
.settings-section { padding: 18px 20px; margin: 0 0 20px; border: 1px solid var(--divider); border-radius: 16px; background: var(--surface-1); }
.theme-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; font-size: .88rem; font-weight: 500; }
.theme-row .theme-switch { min-width: 230px; }
.settings-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 0 2px; border: 0; border-top: 1px solid var(--divider); color: var(--text-primary); background: transparent; text-decoration: none; font-size: .9rem; text-align: left; transition: opacity .15s; }
.settings-row:active { opacity: .7; }
.settings-row > svg { width: 19px; height: 19px; color: var(--text-tertiary); }
.settings-row > span { flex: 1; font-weight: 500; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.section-title-row h2 { font-size: .98rem; font-weight: 650; letter-spacing: -.01em; }
.chevron { width: 17px; height: 17px; flex-shrink: 0; color: var(--text-tertiary); }
.status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 9999px; background: var(--glass-bg); color: var(--text-tertiary); font-size: .75rem; font-weight: 600; }
.status-pill.ready { color: var(--success); background: var(--success-subtle); }
.status-dot { display: block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.reconfigure-button, .save-credential, .cancel-edit { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 1px solid var(--divider); border-radius: 12px; font-size: .84rem; font-weight: 600; transition: transform .15s; }
.reconfigure-button:active, .save-credential:active, .cancel-edit:active { transform: scale(.98); }
.reconfigure-button { justify-content: space-between; width: 100%; color: var(--text-primary); background: var(--surface-2); }
.reconfigure-button svg { width: 16px; height: 16px; }
.credential-form { display: grid; gap: 10px; }
.credential-form label { color: var(--text-secondary); font-size: .8rem; font-weight: 500; }
.credential-form textarea { width: 100%; min-height: 120px; padding: 12px 14px; border: 1px solid var(--divider); border-radius: 12px; color: var(--text-primary); background: var(--surface-2); font-size: 16px; resize: vertical; }
.credential-hint, .managed-hint, .credential-loading { color: var(--text-tertiary); font-size: .74rem; line-height: 1.5; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.save-credential { color: var(--accent-ink); background: var(--liquid-accent); border-color: transparent; }
.cancel-edit { color: var(--text-secondary); background: transparent; }
.logout-button { display: flex; width: 100%; min-height: 50px; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 1px solid var(--divider); border-radius: 16px; color: var(--danger); background: var(--surface-1); font-size: .92rem; font-weight: 600; transition: background .15s, transform .15s; }
.logout-button:active { background: var(--danger-surface); transform: scale(.99); }
.logout-button svg { width: 18px; height: 18px; }
:global(html.ios-standalone .ios-install-link) { display: none; }
@media (min-width: 1024px) { .account-page { width: calc(100% - 240px); margin-left: 240px; padding: 40px max(32px, calc((100vw - 240px - 720px) / 2)); } }
@media (max-width: 640px) {
  .account-page { padding: calc(14px + var(--safe-area-top)) calc(var(--mobile-gutter) + var(--safe-area-right)) var(--mobile-content-bottom) calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .settings-section { padding: 16px; border-radius: 16px; margin-bottom: 16px; }
  .theme-row { gap: 12px; }
  .theme-row .theme-switch { min-width: 0; flex: 1; max-width: 260px; }
}
</style>

<style scoped>
.install-hint { padding: 0 16px 14px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
</style>
