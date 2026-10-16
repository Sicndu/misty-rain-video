<script setup lang="ts">
import { ref } from 'vue';
import { useDialog } from '../../composables/useDialog';
import { Trash2 } from '@lucide/vue';
import type { MediaItem } from '../../types/media';

const props = defineProps<{
  open: boolean;
  media: MediaItem | null;
  deleting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();

const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.open, () => { if (!props.deleting) emit('cancel'); });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="confirm-backdrop"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
      @click.self="!deleting && emit('cancel')"
    >
      <section class="confirm-sheet glass-rim">
        <div class="drag-handle" aria-hidden="true"></div>
        <div class="danger-icon" aria-hidden="true">
          <Trash2 />
        </div>
        <div class="confirm-copy">
          <h2 id="delete-title">移除《{{ media.title }}》的收藏？</h2>
          <p>
            影片目录将移入云盘回收站，可在回收站内恢复；对应观看记录会同步删除。
            <template v-if="(media.duplicateCount || 1) > 1">
              检测到 {{ media.duplicateCount }} 个同名目录，本次只移除当前目录；其余同名内容仍会保留。
            </template>
          </p>
        </div>
        <div class="confirm-actions">
          <button type="button" class="cancel-button" :disabled="deleting" @click="emit('cancel')">
            取消
          </button>
          <button type="button" class="delete-button" :disabled="deleting" @click="emit('confirm')">
            <span v-if="deleting" class="button-spinner" aria-hidden="true"></span>
            {{ deleting ? '正在删除…' : '移入回收站' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop { position: fixed; inset: 0; z-index: 1800; display: flex; align-items: center; justify-content: center; padding: 20px; }
.confirm-sheet { width: min(430px, 100%); padding: 28px; border-radius: 28px; }
.drag-handle { display: none; }
.danger-icon { display: grid; width: 52px; height: 52px; place-items: center; margin-bottom: 18px; border: 1px solid var(--divider); border-radius: 16px; color: var(--danger); background: var(--danger-surface); }
.danger-icon svg { width: 24px; height: 24px; }
.confirm-copy h2 { margin-bottom: 10px; color: var(--text-primary); font-size: 1.25rem; font-weight: 700; line-height: 1.4; letter-spacing: -.02em; overflow-wrap: anywhere; }
.confirm-copy p { color: var(--text-secondary); font-size: .87rem; line-height: 1.65; }
.confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
.confirm-actions button { min-height: 48px; border: 1px solid var(--divider); border-radius: 14px; font-size: .9rem; font-weight: 600; transition: transform .15s, background .15s; }
.confirm-actions button:active { transform: scale(.98); }
.cancel-button { color: var(--text-primary); background: var(--glass-bg); }
.cancel-button:hover { background: var(--glass-bg-hover); }
.delete-button { color: #fff; background: #bb3c4d; border-color: transparent; box-shadow: none; }
.delete-button:hover { background: #ce4457; }
.button-spinner { display: inline-block; width: 14px; height: 14px; margin-right: 5px; border: 1px solid var(--divider); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .confirm-backdrop { align-items: flex-end; padding: 0; }
  .confirm-sheet { padding-top: 12px; border-radius: 28px 28px 0 0; }
  .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 20px; border-radius: 9999px; }
}
</style>
