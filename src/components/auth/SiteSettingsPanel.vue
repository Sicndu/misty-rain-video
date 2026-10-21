<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ImagePlus } from '@lucide/vue';
import { siteSettings, loadSiteSettings, saveSiteSettings, prepareSiteIcons } from '../../services/siteSettings';
import { useToast } from '../../composables/useToast';
const emit = defineEmits<{ (event: 'busy', busy: boolean): void }>();
const toast = useToast(), name = ref(''), subtitle = ref(''), description = ref(''), revision = ref('');
const icons = ref<Record<string,string> | null | undefined>(), loading = ref(true), saving = ref(false), processing = ref(false), error = ref('');
const input = ref<HTMLInputElement | null>(null), conflict = ref(false); let alive = true, imageSequence = 0;
const preview = computed(() => icons.value ? icons.value[512] : icons.value === null ? siteSettings.value.defaults.iconUrl : siteSettings.value.iconUrl);
const hasChanges = computed(() => name.value.trim() !== siteSettings.value.name || subtitle.value.trim() !== siteSettings.value.subtitle || description.value.trim() !== siteSettings.value.description || icons.value !== undefined);
async function reload() {
  loading.value = true; error.value = '';
  try {
    const value = await loadSiteSettings(); if (!alive) return;
    name.value = value.name; subtitle.value = value.subtitle; description.value = value.description; revision.value = value.revision; icons.value = undefined; conflict.value = false;
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '加载失败'; }
  finally { if (alive) loading.value = false; }
}
async function selectIcon(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (input.value) input.value.value = ''; if (!file) return;
  const seq = ++imageSequence; processing.value = true; error.value = ''; emit('busy', true);
  try { const result = await prepareSiteIcons(file); if (alive && seq === imageSequence) icons.value = result; }
  catch (e) { if (alive && seq === imageSequence) error.value = e instanceof Error ? e.message : '图片无法读取'; }
  finally { if (alive && seq === imageSequence) { processing.value = false; emit('busy', false); } }
}
function reset() { const value = siteSettings.value.defaults; name.value = value.name; subtitle.value = value.subtitle; description.value = value.description; icons.value = null; error.value = ''; }
async function save() {
  if (!revision.value || saving.value || processing.value || !name.value.trim()) return;
  saving.value = true; error.value = ''; conflict.value = false; emit('busy', true);
  try {
    const value = await saveSiteSettings({ name: name.value, subtitle: subtitle.value, description: description.value, revision: revision.value, ...(icons.value !== undefined ? { icons: icons.value } : {}) });
    if (!alive) return; name.value = value.name; subtitle.value = value.subtitle; description.value = value.description; revision.value = value.revision; icons.value = undefined; conflict.value = false; toast.show('站点信息已保存', '✓');
  } catch (e) { if (alive) { error.value = e instanceof Error ? e.message : '保存失败'; conflict.value = (e as { statusCode?: number }).statusCode === 409; } }
  finally { if (alive) { saving.value = false; emit('busy', false); } }
}
onMounted(reload); onBeforeUnmount(() => { alive = false; imageSequence++; });
</script>
<template>
  <section class="site-settings" aria-label="站点设置">
    <p v-if="loading" role="status">正在加载…</p>
    <form v-else @submit.prevent="save">
      <div class="site-icon-row"><img :src="preview" alt="站点图标预览" /><div><button type="button" class="choose-icon" :disabled="saving || processing || !revision" @click="input?.click()"><ImagePlus aria-hidden="true" />{{ processing ? '处理图片…' : '更换图标' }}</button><small>PNG、JPG、WebP，最大 5 MB</small></div><input ref="input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传站点图标" @change="selectIcon" /></div>
      <label>站点名称<input v-model="name" name="site-name" maxlength="32" required :disabled="saving || !revision" autocomplete="off" /></label>
      <label>副标题<input v-model="subtitle" name="site-subtitle" maxlength="48" :disabled="saving || !revision" placeholder="可选" autocomplete="off" /></label>
      <label>简介<input v-model="description" name="site-description" maxlength="160" :disabled="saving || !revision" placeholder="可选" autocomplete="off" /></label>
      <p v-if="error" class="site-error" role="alert">{{ error }}<button v-if="conflict || !revision" type="button" @click="reload">重新加载</button></p>
      <footer><button type="button" :disabled="saving || processing || !revision" @click="reset">恢复默认</button><button class="save-site" type="submit" :disabled="saving || processing || !name.trim() || !hasChanges || !revision">{{ saving ? '保存中…' : '保存' }}</button></footer>
      <p class="site-hint">已安装的桌面图标可能需要重新安装才能更新。</p>
    </form>
  </section>
</template>
<style scoped>
.site-settings { padding:24px; border:1px solid var(--divider); border-radius:16px; background:var(--surface-1); }
form { display:grid; gap:22px; } .site-icon-row { display:flex; align-items:center; gap:18px; margin-bottom:4px; }
.site-icon-row img { width:72px; height:72px; border-radius:16px; object-fit:contain; background:var(--surface-2); }
.site-icon-row div { display:grid; gap:8px; }.site-icon-row small,.site-hint { color:var(--text-tertiary); font-size:.75rem; line-height:1.6; }
.site-icon-row input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:42px; padding:0 14px; color:var(--text-secondary); border:1px solid var(--divider); border-radius:8px; background:transparent; cursor:pointer; font-size:.85rem; }
.choose-icon svg { width:17px; height:17px; } label { display:grid; gap:8px; color:var(--text-secondary); font-size:.85rem; }
label input { width:100%; min-height:46px; padding:10px 12px; border:1px solid var(--divider); border-radius:8px; background:var(--surface-2); color:var(--text-primary); font-size:16px; }
footer { display:flex; justify-content:flex-end; gap:10px; }.save-site { min-width:90px; color:var(--accent-ink); background:var(--liquid-accent); border-color:transparent; }
button:disabled { opacity:.5; cursor:default; }.site-error { color:var(--danger); font-size:.82rem; line-height:1.7; }.site-error button { margin-left:10px; }
.site-hint { border-top:1px solid var(--divider); padding-top:16px; }
@media(max-width:640px) { .site-settings { padding:20px 16px; }.site-icon-row { gap:14px; } }
</style>
