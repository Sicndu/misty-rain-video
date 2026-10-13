<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { apiUrl } from '../../services/appUrl';

interface MaintenanceItem {
  quarkFid: string;
  title: string;
  message: string;
  status: string;
  lastAction: string;
  lastActionAt: string;
}
interface MaintenanceStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  checkedAt: string;
  message: string;
  items: MaintenanceItem[];
}
const status = ref<MaintenanceStatus | null>(null);
const error = ref('');
const loading = ref(false);
const controller = new AbortController();
let timer: ReturnType<typeof setInterval> | undefined;
const refresh = async () => {
  if (loading.value || controller.signal.aborted) return;
  loading.value = true;
  try {
    const response = await fetch(apiUrl('/api/library-maintenance'), { credentials: 'same-origin', signal: controller.signal });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw new Error('status unavailable');
    status.value = payload.data;
    error.value = '';
  } catch {
    if (!controller.signal.aborted) error.value = '暂时无法读取自动追更状态';
  } finally { loading.value = false; }
};
const timeLabel = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
onMounted(() => {
  void refresh();
  timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
});
onUnmounted(() => { clearInterval(timer); controller.abort(); });
</script>

<template>
  <div class="maintenance">
    <div class="maintenance-heading">
      <strong>自动追更</strong>
      <span>{{ error ? '待重试' : !status ? '读取中' : !status.enabled ? '未启用' : status.running ? '维护中' : '已开启' }}</span>
    </div>
    <p>保留已有剧集，自动补充新集；来源持续失效后，验证并关联新的追更来源。</p>
    <p v-if="error" role="status">{{ error }}</p>
    <template v-else-if="status">
      <small v-if="status.enabled">约每 {{ status.intervalMinutes }} 分钟检查，关闭页面后仍会运行。</small>
      <small v-else>后台维护未运行，请由管理员检查服务配置。</small>
      <small v-if="status.checkedAt">最近巡检：{{ timeLabel(status.checkedAt) }}</small>
      <small v-else-if="status.enabled">等待首次检查</small>
      <p v-if="status.message" role="status">{{ status.message }}</p>
      <details v-if="status.items.length">
        <summary>查看 {{ status.items.length }} 部影片的维护情况</summary>
        <ul>
          <li v-for="item in status.items" :key="item.quarkFid">
            <strong>{{ item.title }}</strong>
            <p>{{ item.message }}</p>
            <small v-if="item.lastActionAt">{{ timeLabel(item.lastActionAt) }} · {{ item.lastAction }}</small>
          </li>
        </ul>
      </details>
    </template>
    <button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新状态' }}</button>
  </div>
</template>

<style scoped>
.maintenance { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--surface-2); }
.maintenance-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: .86rem; }
.maintenance-heading span { color: var(--liquid-accent); font-size: .75rem; }
p, small { display: block; margin-top: 7px; color: var(--text-tertiary); font-size: .75rem; line-height: 1.7; }
details { margin-top: 12px; font-size: .78rem; color: var(--text-secondary); }
summary { cursor: pointer; min-height: 32px; }
ul { padding: 0; list-style: none; max-height: 320px; overflow: auto; }
li { padding: 12px 0; border-top: 1px solid var(--surface-2); }
li p { margin-top: 3px; }
button { min-height: 44px; margin-top: 8px; border: 0; background: transparent; color: var(--liquid-accent); font-size: .78rem; }
</style>
