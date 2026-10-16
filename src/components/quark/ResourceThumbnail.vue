<script setup lang="ts">
import { ref, watch } from 'vue';
import { File, Folder, Video } from '@lucide/vue';
const props = defineProps<{ src?: string; directory?: boolean; video?: boolean }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
</script>
<template><span class="resource-thumbnail"><img v-if="src && !failed" :src="src" alt="" loading="lazy" decoding="async" @error="failed = true" /><component v-else :is="directory ? Folder : video ? Video : File" aria-hidden="true" /></span></template>
<style scoped>
.resource-thumbnail { display: grid; width: 52px; height: 52px; flex: 0 0 52px; overflow: hidden; place-items: center; border-radius: 8px; color: var(--liquid-accent); background: var(--surface-2); }
.resource-thumbnail img { width: 100%; height: 100%; object-fit: cover; }
.resource-thumbnail svg { width: 27px; height: 27px; stroke-width: 1.5; }
</style>
