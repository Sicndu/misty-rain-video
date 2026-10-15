<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue';
import { themePreference, setTheme } from '../../services/theme';
</script>
<template>
  <div class="theme-switch" role="group" aria-label="主题颜色">
    <button type="button" aria-label="跟随系统" title="跟随系统" :aria-pressed="themePreference === 'system'" @click="setTheme('system')"><Monitor aria-hidden="true" />系统</button>
    <button type="button" :aria-pressed="themePreference === 'dark'" @click="setTheme('dark')"><Moon aria-hidden="true" />暗色</button>
    <button type="button" :aria-pressed="themePreference === 'light'" @click="setTheme('light')"><Sun aria-hidden="true" />浅色</button>
  </div>
</template>
<style scoped>
.theme-switch { display: flex; gap: 3px; padding: 3px; border: var(--glass-border); border-radius: 12px; background: var(--glass-bg); }
button { display: flex; flex: 1; min-width: 0; min-height: 38px; align-items: center; justify-content: center; gap: 5px; padding: 0 6px; border: 0; border-radius: 9px; background: transparent; color: var(--text-secondary); font-size: .78rem; font-weight: 550; white-space: nowrap; transition: color .15s, background .15s, transform .15s; }
button:active { transform: scale(.97); }
button[aria-pressed='true'] { color: var(--text-primary); font-weight: 650; background: var(--surface-elevated); box-shadow: 0 2px 6px rgba(0, 0, 0, .15); }
svg { width: 16px; height: 16px; }
</style>
