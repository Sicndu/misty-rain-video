<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiUrl } from '../../services/appUrl';

const props = defineProps<{ src?: string; alt: string }>();
const failed = ref(false);
const fallback = apiUrl('/poster-placeholder.svg');
const imageUrl = computed(() => failed.value || !props.src || props.src.includes('photo-1578836537282-3171d77f8632') ? fallback : props.src);
watch(() => props.src, () => { failed.value = false; });
</script>

<template>
  <img :src="imageUrl" :alt="alt" @error="failed = true" />
</template>
