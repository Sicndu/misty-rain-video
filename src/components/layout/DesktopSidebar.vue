<script setup lang="ts">
import { siteSettings } from '../../services/siteSettings';
import { Compass, Clapperboard, Film, Sparkles, Tv, Settings, History } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import type { AppUser } from '../../services/authService';
import type { CategoryType } from '../../types/media';
defineProps<{ activePage: 'discover' | 'library' | 'history' | 'account'; category: CategoryType; counts: Record<CategoryType, number>; user: AppUser; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'library', category?: CategoryType): void; (e: 'account'): void; (e: 'discover'): void; (e: 'history'): void }>();
const categories = [
  { value: 'tv' as const, title: '电视剧', icon: Tv },
  { value: 'movie' as const, title: '电影', icon: Film },
  { value: 'variety' as const, title: '综艺', icon: Clapperboard },
  { value: 'anime' as const, title: '动漫', icon: Sparkles }
];
</script>
<template>
  <aside class="desktop-sidebar" aria-label="桌面导航">
    <button class="sidebar-brand" type="button" :disabled="disabled" @click="emit('discover')"><BrandMark /><span><strong>{{ siteSettings.name }}</strong><small v-if="siteSettings.subtitle">{{ siteSettings.subtitle }}</small></span></button>
    <nav aria-label="主要导航与收藏分类">
      <button class="sidebar-discover" type="button" :class="{ active: activePage === 'discover' }" :aria-current="activePage === 'discover' ? 'page' : undefined" :disabled="disabled" @click="emit('discover')"><Compass aria-hidden="true" /><span>发现</span></button>
      <button type="button" :class="{ active: activePage === 'history' }" :aria-current="activePage === 'history' ? 'page' : undefined" :disabled="disabled" @click="emit('history')"><History aria-hidden="true" /><span>观看记录</span></button>
      <p class="nav-label">收藏 / 追更</p>
      <button v-for="item in categories" :key="item.value" type="button" :class="{ active: activePage === 'library' && category === item.value }" :aria-current="activePage === 'library' && category === item.value ? 'page' : undefined" :disabled="disabled" @click="emit('library', item.value)">
        <component :is="item.icon" aria-hidden="true" /><span>{{ item.title }}</span><small>{{ counts[item.value] }}</small>
      </button>
    </nav>
    <div class="sidebar-bottom"><button class="sidebar-settings" type="button" :class="{ active: activePage === 'account' }" :aria-current="activePage === 'account' ? 'page' : undefined" :disabled="disabled" @click="emit('account')"><Settings aria-hidden="true" />设置</button></div>
  </aside>
</template>
<style scoped>
.desktop-sidebar { display: none; }
@media (min-width: 1024px) {
  .desktop-sidebar { display: flex; position: fixed; inset: 0 auto 0 0; z-index: 200; width: 240px; flex-direction: column; padding: 32px 20px 24px; border-right: var(--glass-border); background: var(--surface-1); }
  button { border: 0; color: var(--text-secondary); background: transparent; text-align: left; }
  .sidebar-brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 32px; }
  .sidebar-brand > :first-child { width: 38px; height: 38px; border-radius: 12px; }
  .sidebar-brand > span { min-width:0; }
  .sidebar-brand strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display: block; color: var(--text-primary); font-size: 1rem; }
  .sidebar-brand small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display: block; font-size: .58rem; letter-spacing: .15em; margin-top: 4px; color: var(--text-tertiary); }
  nav { display: grid; gap: 6px; }
  nav button { display: flex; align-items: center; gap: 11px; min-height: 46px; padding: 0 14px; border-radius: 10px; font-size: .88rem; }
  nav button svg { width: 18px; height: 18px; }
  nav button small { margin-left: auto; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  nav button:hover, nav button.active { color: var(--text-primary); background: var(--glass-bg-active); }
  .nav-label { padding: 16px 14px 5px; color: var(--text-tertiary); font-size: .68rem; }
  .sidebar-bottom { margin-top: auto; padding-top: 24px; }
  .sidebar-settings { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 46px; padding: 0 14px; border-radius: 10px; font-size: .88rem; }
  .sidebar-settings svg { width: 18px; height: 18px; }
  .sidebar-settings:hover, .sidebar-settings.active { color: var(--text-primary); background: var(--glass-bg-active); }
}
</style>
