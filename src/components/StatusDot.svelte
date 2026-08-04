<script>
  let { status, labels = {} } = $props()

  const palette = {
    connected: 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400/60',
    up: 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400/60',
    connecting: 'bg-amber-400 animate-pulse',
    paused: 'bg-sky-400',
    disconnected: 'bg-slate-600',
    down: 'bg-rose-500',
    disposed: 'bg-slate-700',
    error: 'bg-rose-500 shadow-[0_0_10px] shadow-rose-500/60',
  }

  let text = $derived(labels[status] ?? status)
</script>

<span class="inline-flex items-center gap-1.5">
  <span class="h-2 w-2 shrink-0 rounded-full {palette[status] ?? 'bg-slate-600'}"></span>
  <span class="text-[11px] font-medium text-slate-400 capitalize">{text}</span>
</span>
