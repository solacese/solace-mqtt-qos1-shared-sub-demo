<script>
  import { anchor } from '../lib/anchors.js'
  import { keyCss } from '../lib/keyColor.js'

  let { consumer, registry, share } = $props()

  const stateRing = {
    up: 'border-solace/50 bg-solace/8',
    paused: 'border-sky-500/50 bg-sky-500/8',
    connecting: 'border-amber-500/40 bg-amber-500/5',
    down: 'border-rose-500/50 bg-rose-500/8',
    disposed: 'border-ink-800 bg-ink-900/60',
  }
</script>

<!-- Static representation of one bound consumer. This is what packets travel to.
     Its controls (delay, pause, remove) live in the right-hand panel. -->
<div
  use:anchor={{ registry, name: `consumer-${consumer.id}` }}
  class="shrink-0 rounded-lg border-2 px-2.5 py-2 transition-colors {stateRing[consumer.state] ??
    'border-ink-800 bg-ink-900/60'}"
>
  <div class="flex items-baseline gap-1.5">
    <span class="truncate text-[11px] font-semibold text-slate-200">{consumer.label}</span>
    <span class="ml-auto font-mono text-sm font-semibold text-solace">{consumer.receivedCount}</span>
  </div>

  <div class="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-ink-850">
    <div
      class="h-full rounded-full bg-solace/70 transition-[width] duration-500"
      style:width="{share * 100}%"
    ></div>
  </div>

  <!-- Distinct partition keys this consumer has actually received. On a
       partitioned queue these lists stay short and disjoint; on a non-exclusive
       queue every consumer accumulates every key. -->
  <div class="mt-1.5 flex min-h-[16px] flex-wrap gap-1">
    {#each consumer.keysSeen as key (key)}
      {@const c = keyCss(key === '(no key)' ? null : key)}
      <span
        class="rounded px-1 py-px font-mono text-[9px] leading-tight"
        style:color={c.fg}
        style:background={c.bg}
        style:border="1px solid {c.border}"
      >
        {key}
      </span>
    {:else}
      <span class="text-[9px] text-slate-600">idle</span>
    {/each}
  </div>

  {#if consumer.state === 'paused'}
    <p class="mt-1 text-[9px] text-sky-300/90">
      paused{consumer.heldCount ? ` · ${consumer.heldCount} held` : ''}
    </p>
  {:else if consumer.state === 'down'}
    <p class="mt-1 truncate text-[9px] text-rose-300/90" title={consumer.error}>down</p>
  {/if}
</div>
