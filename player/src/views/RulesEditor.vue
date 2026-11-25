<template>
  <div class="rp-rules">
    <fieldset class="rp-fieldset">
      <legend>Qué bajar</legend>
      <label v-for="m in MODES" :key="m.value" class="rp-radio">
        <input v-model="rules.mode" type="radio" :value="m.value" />
        <span>{{ m.label }}<br /><small class="rp-muted">{{ m.hint }}</small></span>
      </label>
      <label v-if="rules.mode === 'since'" class="rp-inline">
        Desde el año <input v-model.number="rules.since_year" class="rp-input rp-year" type="number" min="1900" :max="thisYear" />
      </label>
    </fieldset>
    <fieldset class="rp-fieldset">
      <legend>Tipos</legend>
      <div class="rp-chips">
        <label v-for="t in TYPES" :key="t.value" :class="['rp-chip', { on: rules.types.includes(t.value) }]">
          <input v-model="rules.types" type="checkbox" :value="t.value" /> {{ t.label }}
        </label>
      </div>
      <small class="rp-muted">Un sencillo que también está en un disco no se baja dos veces.</small>
    </fieldset>
    <div class="rp-rules-actions">
      <button class="rp-btn" @click="emit('cancel')">Cancelar</button>
      <button class="rp-btn rp-primary" :disabled="!valid || busy" @click="emit('save', { ...rules, since_year: rules.mode === 'since' ? rules.since_year : null })">
        <span v-if="busy" class="rp-spin"></span> {{ saveLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { Rules } from '../lib/api'
import { DEFAULT_RULES, MODES, TYPES } from '../lib/library'

const props = defineProps<{ initial?: Rules | null; saveLabel: string; busy?: boolean }>()
const emit = defineEmits<{ save: [Rules]; cancel: [] }>()
const thisYear = new Date().getFullYear()
const start = props.initial || DEFAULT_RULES
const rules = reactive<Rules>({ mode: start.mode, since_year: start.since_year ?? thisYear - 5, types: [...start.types] })
const valid = computed(() => rules.types.length > 0 && (rules.mode !== 'since' || (rules.since_year >= 1900 && rules.since_year <= thisYear + 1)))
</script>
