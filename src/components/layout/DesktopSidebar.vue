<script setup lang="ts">
import { Clapperboard, Film, Library, Sparkles, Tv, UserRound } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import ThemeSwitch from '../common/ThemeSwitch.vue';
import UserAvatar from '../common/UserAvatar.vue';
import type { AppUser } from '../../services/authService';
import type { CategoryType } from '../../types/media';
defineProps<{ activePage: 'library' | 'account'; category: CategoryType; counts: Record<CategoryType, number>; user: AppUser; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'library', category?: CategoryType): void; (e: 'account'): void }>();
const categories = [
  { value: 'tv' as const, title: '电视剧', icon: Tv },
  { value: 'movie' as const, title: '电影', icon: Film },
  { value: 'variety' as const, title: '综艺', icon: Clapperboard },
  { value: 'anime' as const, title: '动漫', icon: Sparkles }
];
</script>
<template>
  <aside class="desktop-sidebar" aria-label="桌面导航">
    <button class="sidebar-brand" type="button" :disabled="disabled" @click="emit('library')"><BrandMark /><span><strong>烟雨影视</strong><small>MISTY RAIN</small></span></button>
    <nav aria-label="片库与账户">
      <button type="button" class="nav-main" :class="{ active: activePage === 'library' }" :disabled="disabled" @click="emit('library')"><Library aria-hidden="true" />我的片库</button>
      <p class="nav-label">影片分类</p>
      <button v-for="item in categories" :key="item.value" type="button" :class="{ active: activePage === 'library' && category === item.value }" :disabled="disabled" @click="emit('library', item.value)">
        <component :is="item.icon" aria-hidden="true" /><span>{{ item.title }}</span><small>{{ counts[item.value] }}</small>
      </button>
      <button type="button" class="nav-main account-link" :class="{ active: activePage === 'account' }" :disabled="disabled" @click="emit('account')"><UserRound aria-hidden="true" />我的</button>
    </nav>
    <div class="sidebar-bottom"><ThemeSwitch /><button class="sidebar-user" type="button" :disabled="disabled" @click="emit('account')"><UserAvatar :username="user.username" /><span>{{ user.username }}<small>{{ user.role === 'admin' ? '管理员' : '片库账户' }}</small></span></button></div>
  </aside>
</template>
<style scoped>
.desktop-sidebar { display: none; }
@media (min-width: 1024px) {
  .desktop-sidebar { display: flex; position: fixed; inset: 0 auto 0 0; z-index: 200; width: 240px; flex-direction: column; padding: 32px 20px 24px; border-right: var(--glass-border); background: var(--surface-1); }
  button { border: 0; color: var(--text-secondary); background: transparent; text-align: left; }
  .sidebar-brand { display: flex; align-items: center; gap: 12px; padding: 0 8px 32px; }
  .sidebar-brand > :first-child { width: 38px; height: 38px; border-radius: 12px; }
  .sidebar-brand strong { display: block; color: var(--text-primary); font-size: 1rem; }
  .sidebar-brand small { display: block; font-size: .58rem; letter-spacing: .15em; margin-top: 4px; color: var(--text-tertiary); }
  nav { display: grid; gap: 6px; }
  nav button { display: flex; align-items: center; gap: 11px; min-height: 46px; padding: 0 14px; border-radius: 10px; font-size: .88rem; }
  nav button svg { width: 18px; height: 18px; }
  nav button small { margin-left: auto; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  nav button:hover, nav button.active { color: var(--text-primary); background: var(--glass-bg-active); }
  nav .nav-main { font-weight: 650; }
  .nav-label { padding: 16px 14px 5px; color: var(--text-tertiary); font-size: .68rem; }
  .account-link { margin-top: 20px; }
  .sidebar-bottom { display: grid; gap: 22px; margin-top: auto; padding-top: 24px; }
  .sidebar-user { display: flex; gap: 11px; align-items: center; padding: 0 4px; }
  .sidebar-user > :first-child { width: 34px; height: 34px; }
  .sidebar-user span { font-size: .82rem; color: var(--text-primary); }
  .sidebar-user small { display: block; margin-top: 3px; font-size: .68rem; color: var(--text-tertiary); }
}
</style>
