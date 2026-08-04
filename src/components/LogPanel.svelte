<script>
  let { log } = $props()

  let filter = $state('all') // all | mqtt | solace
  let open = $state(true)
  let listEl = $state(null)

  let shown = $derived(
    filter === 'all' ? log.entries : log.entries.filter((e) => e.source === filter)
  )

  const tone = {
    ok: 'text-emerald-400',
    warn: 'text-amber-400',
    error: 'text-rose-400',
    info: 'text-slate-400',
  }
  const sourceTone = {
    mqtt: 'text-mqtt',
    solace: 'text-solace',
  }

  // Follow the tail, which is what you want while watching a demo run.
  $effect(() => {
    void shown.length
    if (listEl) listEl.scrollTop = listEl.scrollHeight
  })
</script>

<section class="flex min-h-0 flex-col rounded-xl border border-ink-800 bg-ink-900/70">
  <header class="flex items-center gap-3 px-4 py-2">
    <button
      onclick={() => (open = !open)}
      class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase transition hover:text-slate-200"
    >
      <span class="inline-block transition-transform {open ? 'rotate-90' : ''}">▸</span>
      Event log
    </button>

    <div class="ml-auto flex items-center gap-1">
      {#each [['all', 'All'], ['mqtt', 'MQTT'], ['solace', 'Solace']] as [value, label] (value)}
        <button
          onclick={() => (filter = value)}
          class="rounded px-2 py-0.5 text-[10px] font-medium transition {filter === value
            ? 'bg-ink-800 text-slate-200'
            : 'text-slate-500 hover:text-slate-300'}"
        >
          {label}
        </button>
      {/each}
      <button
        onclick={() => log.clear()}
        class="ml-1 rounded px-2 py-0.5 text-[10px] text-slate-500 transition hover:text-slate-300"
      >
        Clear
      </button>
    </div>
  </header>

  {#if open}
    <div
      bind:this={listEl}
      class="min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-ink-800 px-4 py-2 font-mono text-[11px]"
    >
      {#each shown as entry (entry.id)}
        <div class="flex gap-2 leading-relaxed">
          <span class="shrink-0 text-slate-600">{entry.at}</span>
          <span class="w-12 shrink-0 {sourceTone[entry.source] ?? 'text-slate-500'}">
            {entry.source}
          </span>
          <span class="{tone[entry.level]} break-words">{entry.message}</span>
        </div>
      {:else}
        <p class="py-2 text-slate-600">Nothing logged yet.</p>
      {/each}
    </div>
  {/if}
</section>
