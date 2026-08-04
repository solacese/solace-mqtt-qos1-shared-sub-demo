<script>
  import StatusDot from './StatusDot.svelte'

  let { consumer, onPause, onRemove, onDelay } = $props()

  let expanded = $state(false)
  let last = $derived(consumer.lastMessage)
</script>

<!-- Configuration for one consumer. The consumer's *visual* representation lives
     on the flow stage; this is only its controls and message inspector. -->
<div class="rounded-lg border border-ink-800 bg-ink-950/40 px-2.5 py-2">
  <header class="flex items-center gap-2">
    <span class="text-[11px] font-semibold text-slate-200">{consumer.label}</span>
    <StatusDot status={consumer.state} />
    <span class="ml-auto font-mono text-[11px] text-slate-500">{consumer.receivedCount}</span>
    <button
      onclick={onRemove}
      title="Remove this consumer"
      class="rounded px-1 text-slate-600 transition hover:bg-ink-800 hover:text-rose-400"
      aria-label="Remove {consumer.label}"
    >
      ✕
    </button>
  </header>

  {#if consumer.error}
    <p class="mt-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
      {consumer.error}
    </p>
  {/if}

  <label class="mt-1.5 block">
    <span class="mb-1 flex items-center justify-between text-[10px] text-slate-500">
      <span>Processing delay</span>
      <span class="font-mono text-slate-400">{consumer.delayMs} ms</span>
    </span>
    <input
      type="range"
      min="0"
      max="5000"
      step="100"
      value={consumer.delayMs}
      oninput={(e) => onDelay(Number(e.currentTarget.value))}
      class="w-full"
    />
  </label>

  <div class="mt-1.5 flex items-center gap-1.5">
    <button
      onclick={onPause}
      class="flex-1 rounded border px-2 py-1 text-[11px] font-medium transition {consumer.paused
        ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
        : 'border-ink-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'}"
    >
      {consumer.paused ? 'Resume' : 'Pause'}
    </button>
    <button
      onclick={() => (expanded = !expanded)}
      disabled={!last}
      class="rounded border border-ink-700 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
    >
      {expanded ? 'Hide' : 'Last msg'}
    </button>
  </div>

  {#if consumer.paused && consumer.heldCount > 0}
    <p class="mt-1.5 text-[10px] text-sky-300/80">
      {consumer.heldCount} message{consumer.heldCount === 1 ? '' : 's'} held unacked — the broker may
      redeliver them to another consumer.
    </p>
  {/if}

  {#if expanded && last}
    <div class="mt-1.5 space-y-1.5 rounded border border-ink-800 bg-ink-950/70 p-2">
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-[10px] break-all text-slate-400">{last.topic}</span>
        <span class="shrink-0 text-[10px] text-slate-600">{last.receivedAt}</span>
      </div>
      {#if last.redelivered}
        <span class="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
          redelivered
        </span>
      {/if}

      <!-- The received SMF user property map, verbatim: the evidence that an
           MQTT 5 User Property survived the hop into the Solace binding. -->
      <div>
        <p class="mb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
          SMF user properties
        </p>
        {#if Object.keys(last.userProperties).length === 0}
          <p class="text-[10px] text-amber-400/80">
            none received — MQTT user properties did not reach the SMF consumer
          </p>
        {:else}
          <dl class="space-y-0.5">
            {#each Object.entries(last.userProperties) as [k, v] (k)}
              <div class="flex gap-1.5 font-mono text-[10px]">
                <dt class="shrink-0 text-slate-500">{k}</dt>
                <dd class="break-all text-slate-300">{v}</dd>
              </div>
            {/each}
          </dl>
        {/if}
      </div>

      <div>
        <p class="mb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Payload</p>
        <pre
          class="max-h-24 overflow-auto font-mono text-[10px] break-all whitespace-pre-wrap text-slate-400">{last.body}</pre>
      </div>
    </div>
  {/if}
</div>
