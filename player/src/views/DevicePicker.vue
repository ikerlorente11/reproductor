<template>
  <button :class="['rp-pbtn', 'rp-devices', { on: !!connect.controlling || panel === 'devices' }]"
          :title="connect.controlling ? `Controlando ${controlled?.name}` : 'Dispositivos'" aria-label="Dispositivos" :aria-pressed="panel === 'devices'"
          @click.stop="togglePanel('devices')">
    <i class="rp-i rp-i-devices" aria-hidden="true"></i><span v-if="count && others.length" class="rp-devcount">{{ others.length + 1 }}</span>
  </button>
</template>

<script setup lang="ts">
import { connect, controlled, others } from '../lib/connect'
import { panel, togglePanel } from '../lib/phone'

/** `count`: how many devices are connected, on the button (not on the phone's small bar, where it looks like a warning) */
withDefaults(defineProps<{ count?: boolean }>(), { count: true })

/** The devices' button of the player (as Spotify Connect): it opens the devices' panel (DevicesPanel), in the page's
 *  place on a wide screen or in the player's on a phone. */
</script>
