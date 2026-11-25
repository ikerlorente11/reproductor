<template>
  <button :class="['rp-pbtn', 'rp-devices', { on: !!connect.controlling || panel === 'devices' }]"
          :title="connect.controlling ? `Controlando ${controlled?.name}` : 'Dispositivos'" aria-label="Dispositivos" :aria-pressed="panel === 'devices'"
          @click.stop="togglePanel('devices')">
    <i class="rp-i rp-i-devices" aria-hidden="true"></i><span v-if="others.length" class="rp-devcount">{{ others.length + 1 }}</span>
  </button>
</template>

<script setup lang="ts">
import { connect, controlled, others } from '../lib/connect'
import { panel, togglePanel } from '../lib/phone'

/** The devices' button of the player (as Spotify Connect): it opens the devices' panel (DevicesPanel), in the page's
 *  place on a wide screen or in the player's on a phone. */
</script>
