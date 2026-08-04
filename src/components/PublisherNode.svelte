<script>
  import { anchor } from '../lib/anchors.js'
  import { keyCss } from '../lib/keyColor.js'

  let { publisher, registry } = $props()

  let live = $derived(publisher.connected)
</script>

<!-- Static representation of the publisher on the flow stage. All of its
     configuration lives in the left-hand panel; this node exists only to be a
     place the message flow starts from. -->
<div
  use:anchor={{ registry, name: 'mqtt' }}
  class="relative w-full rounded-xl border-2 px-3 py-3 text-center transition-colors {live
    ? 'border-mqtt/50 bg-mqtt/8 shadow-[0_0_40px] shadow-mqtt/10'
    : 'border-ink-800 bg-ink-900/60'}"
>
  <p class="text-[9px] font-semibold tracking-widest uppercase {live ? 'text-mqtt/80' : 'text-slate-600'}">
    MQTT 5
  </p>
  <p class="mt-0.5 text-[11px] font-semibold text-slate-200">Publisher</p>

  <p class="mt-2 font-mono text-xl font-semibold {live ? 'text-slate-100' : 'text-slate-600'}">
    {publisher.publishedCount}
  </p>
  <p class="text-[9px] tracking-wide text-slate-500 uppercase">published</p>

  <p class="mt-1.5 text-[9px] text-slate-500">QoS 1 · Guaranteed</p>

  {#if publisher.lastKey}
    {@const c = keyCss(publisher.lastKey)}
    <span
      class="mt-2 inline-block rounded px-1.5 py-0.5 font-mono text-[10px]"
      style:color={c.fg}
      style:background={c.bg}
      style:border="1px solid {c.border}"
    >
      {publisher.lastKey}
    </span>
  {/if}

  {#if !live}
    <span
      class="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 px-2 py-0.5 text-[9px] whitespace-nowrap text-slate-500 ring-1 ring-ink-700"
    >
      not connected
    </span>
  {/if}
</div>
