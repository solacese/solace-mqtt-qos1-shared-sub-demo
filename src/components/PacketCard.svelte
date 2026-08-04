<script>
  import { keyCss } from '../lib/keyColor.js'

  let { packet, register } = $props()

  let el = $state(null)
  let colors = $derived(keyCss(packet.key))

  // FlowLayer walks this node along the drawn edge geometry on every animation
  // frame, so it needs the element itself rather than reactive coordinates — and
  // there is deliberately no CSS transition on `transform` to fight with it.
  $effect(() => {
    if (!el) return
    register(packet.id, el)
    return () => register(packet.id, null)
  })

  const RING = 2 * Math.PI * 9

  let phaseClass = $derived(
    {
      publishing: 'opacity-100',
      queued: 'packet-queued opacity-100',
      delivering: 'opacity-100',
      processing: 'opacity-100',
      done: 'packet-done opacity-0',
      failed: 'opacity-90',
      orphaned: 'opacity-40',
    }[packet.phase] ?? 'opacity-100'
  )
</script>

<div bind:this={el} class="packet {phaseClass}" style:--packet-glow={colors.glow}>
  <div
    class="flex w-[132px] items-center gap-2 rounded-lg border px-2 py-1.5 backdrop-blur-sm"
    style:background="color-mix(in oklab, {colors.bg}, oklch(0.2 0.02 265) 55%)"
    style:border-color={packet.phase === 'failed' ? 'oklch(0.6 0.2 20)' : colors.border}
    style:box-shadow="0 4px 14px -4px {colors.glow}"
  >
    {#if packet.phase === 'processing'}
      <!-- Progress ring: the consumer's simulated work window. -->
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 -rotate-90">
        <circle cx="12" cy="12" r="9" fill="none" stroke="oklch(0.3 0.02 265)" stroke-width="2.5" />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke={colors.fg}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray={RING}
          stroke-dashoffset={RING * (1 - packet.progress)}
        />
      </svg>
    {:else}
      <span
        class="h-2.5 w-2.5 shrink-0 rounded-full"
        style:background={colors.fg}
        style:box-shadow="0 0 8px {colors.fg}"
      ></span>
    {/if}

    <div class="min-w-0 flex-1 leading-tight">
      <p class="truncate font-mono text-[10px] font-semibold" style:color={colors.fg}>
        {packet.key ?? 'no key'}
      </p>
      <p class="truncate font-mono text-[9px] text-slate-400">
        {#if packet.phase === 'failed'}
          failed
        {:else if packet.note}
          {packet.note}
        {:else}
          {packet.id}
        {/if}
      </p>
    </div>

    {#if packet.redelivered}
      <span class="shrink-0 text-[9px] text-amber-400" title="redelivered">↺</span>
    {/if}
  </div>
</div>
