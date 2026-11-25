<template>
  <div class="rp-selbar" role="toolbar" :aria-label="label">
    <span class="rp-selbar-count"><strong>{{ count }}</strong> {{ label }}</span>
    <button v-if="total > count" class="rp-btn rp-small" @click="emit('all')">Seleccionar todo ({{ total }})</button>
    <button v-else-if="count" class="rp-btn rp-small" @click="emit('none')">Quitar la selección</button>
    <span class="rp-selbar-gap"></span>
    <button class="rp-btn rp-small" @click="emit('cancel')">Cancelar</button>
    <button class="rp-btn rp-small rp-danger-solid" :disabled="!count" @click="emit('delete')"><i class="rp-i rp-i-delete" aria-hidden="true"></i> Borrar</button>
  </div>
</template>

<script setup lang="ts">
/** The bar of a selection (songs or releases): how many, select all, delete them, leave. */
defineProps<{ count: number; total: number; label: string }>()
const emit = defineEmits<{ all: []; none: []; cancel: []; delete: [] }>()
</script>
