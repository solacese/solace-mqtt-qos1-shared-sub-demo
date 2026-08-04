<script>
  let {
    label,
    value = $bindable(),
    type = 'text',
    placeholder = '',
    hint = null,
    disabled = false,
    min = null,
    max = null,
    mono = false,
  } = $props()

  const id = `f-${Math.random().toString(36).slice(2, 8)}`
</script>

<label class="block" for={id}>
  <span class="mb-1 flex items-baseline justify-between gap-2">
    <span class="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</span>
    {#if hint}
      <span class="text-[10px] text-slate-500">{hint}</span>
    {/if}
  </span>
  {#if type === 'number'}
    <input
      {id}
      type="number"
      {min}
      {max}
      {disabled}
      {placeholder}
      bind:value
      class="w-full rounded-md border border-ink-800 bg-ink-950/60 px-2.5 py-1.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-slate-500 disabled:opacity-50"
    />
  {:else if type === 'password'}
    <input
      {id}
      type="password"
      {disabled}
      {placeholder}
      bind:value
      class="w-full rounded-md border border-ink-800 bg-ink-950/60 px-2.5 py-1.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-slate-500 disabled:opacity-50"
    />
  {:else}
    <input
      {id}
      type="text"
      {disabled}
      {placeholder}
      bind:value
      class="w-full rounded-md border border-ink-800 bg-ink-950/60 px-2.5 py-1.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-slate-500 disabled:opacity-50 {mono
        ? 'font-mono text-[12px]'
        : ''}"
    />
  {/if}
</label>
