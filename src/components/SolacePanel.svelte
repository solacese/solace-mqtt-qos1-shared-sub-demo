<script>
  import Field from './Field.svelte'
  import StatusDot from './StatusDot.svelte'
  import ConsumerControls from './ConsumerControls.svelte'

  // Configuration only — each consumer's representation on the flow stage is a
  // ConsumerNode, so this panel owns no animation anchors.
  let { consumers } = $props()

  // Deeply-reactive $state object; its properties are safe to bind into.
  let cfg = $derived(consumers.config)

  let locked = $derived(consumers.status === 'connected' || consumers.status === 'connecting')
  let total = $derived(consumers.totalReceived)

  // Collapse the connection form once we're up. It is tall enough to push the
  // consumer cards out of the panel, and the consumer cards are where the
  // animation lands — an off-screen target makes the whole demo unreadable.
  let showConnection = $state(true)
  let wasConnected = false
  $effect(() => {
    if (consumers.connected && !wasConnected) showConnection = false
    if (!consumers.connected && wasConnected) showConnection = true
    wasConnected = consumers.connected
  })
</script>

<section
  class="flex h-full min-h-0 flex-col rounded-xl border border-ink-800 bg-ink-900/70 backdrop-blur"
>
  <header class="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
    <div>
      <h2 class="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <span class="h-2.5 w-2.5 rounded-sm bg-solace"></span>
        Solace Consumers
      </h2>
      <p class="mt-0.5 text-[11px] text-slate-500">solclientjs · queue bind · client ack</p>
    </div>
    <StatusDot status={consumers.status} />
  </header>

  <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
    <button
      onclick={() => (showConnection = !showConnection)}
      class="flex w-full items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase transition hover:text-slate-200"
    >
      <span class="inline-block transition-transform {showConnection ? 'rotate-90' : ''}">▸</span>
      Connection &amp; queue
    </button>

    {#if showConnection}
      <div class="space-y-2.5">
        <Field
          label="WebSocket URL"
          bind:value={cfg.url}
          disabled={locked}
          hint="ws://…:8008 · wss://…:443"
          mono
        />
        <div class="grid grid-cols-2 gap-2.5">
          <Field label="Message VPN" bind:value={cfg.vpnName} disabled={locked} />
          <Field label="Username" bind:value={cfg.userName} disabled={locked} />
        </div>
        <Field
          label="Password"
          type="password"
          bind:value={cfg.password}
          disabled={locked}
          hint="not saved"
        />
        <Field
          label="Queue name"
          bind:value={cfg.queueName}
          disabled={locked}
          hint="must already exist"
          mono
        />

        <div class="space-y-1.5">
          <Field
            label="Topic subscription on queue"
            bind:value={cfg.topicSubscription}
            disabled={locked}
            hint="> and * wildcards"
            mono
          />
          <label class="flex items-start gap-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              bind:checked={cfg.addSubscription}
              disabled={locked}
              class="mt-0.5 accent-emerald-500"
            />
            <span>
              Add this subscription to the queue on connect. Untick if the queue is already mapped,
              or if the client profile forbids it.
            </span>
          </label>
        </div>

        <Field
          label="Partition key user property"
          bind:value={cfg.partitionKeyProperty}
          hint="read from received msgs"
          mono
        />

        <div class="space-y-1">
          <Field
            label="Flow window size"
            type="number"
            min="1"
            max="255"
            bind:value={cfg.windowSize}
            disabled={locked}
            hint="1–255"
          />
          <p class="text-[10px] leading-snug text-slate-500">
            How many unacked messages the broker will send a single consumer. The API default is
            <span class="text-slate-400">255</span>, which lets the first consumer buffer the whole
            stream locally and makes load balancing invisible. Keep it at
            <span class="text-slate-400">1</span> for the clearest demo.
          </p>
        </div>
      </div>

      {#if consumers.error}
        <p
          class="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300"
        >
          {consumers.error}
        </p>
      {/if}

      <div class="flex gap-2">
        {#if consumers.connected || consumers.status === 'connecting'}
          <button
            onclick={() => consumers.disconnect()}
            class="flex-1 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
          >
            Disconnect
          </button>
        {:else}
          <button
            onclick={() => consumers.connect()}
            class="flex-1 rounded-md bg-solace/15 px-3 py-2 text-sm font-semibold text-solace ring-1 ring-solace/40 transition hover:bg-solace/25"
          >
            Connect &amp; bind
          </button>
        {/if}
      </div>
    {/if}

    <hr class="border-ink-800" />

    <div class="flex items-center justify-between gap-2">
      <div>
        <h3 class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Consumers on queue
        </h3>
        <p class="text-[10px] text-slate-500">{total} received in total</p>
      </div>
      <div class="flex items-center gap-1">
        <button
          onclick={() => consumers.removeConsumer()}
          disabled={consumers.consumers.length === 0}
          class="h-7 w-7 rounded border border-ink-700 text-slate-400 transition hover:border-slate-600 hover:text-slate-100 disabled:opacity-40"
          aria-label="Remove a consumer"
        >
          −
        </button>
        <span class="w-7 text-center font-mono text-sm text-slate-200">
          {consumers.consumers.length}
        </span>
        <button
          onclick={() => consumers.addConsumer()}
          disabled={!consumers.connected || consumers.consumers.length >= 12}
          class="h-7 w-7 rounded border border-ink-700 text-slate-400 transition hover:border-slate-600 hover:text-slate-100 disabled:opacity-40"
          aria-label="Add a consumer"
        >
          +
        </button>
      </div>
    </div>

    <label class="block">
      <span class="mb-1 flex items-center justify-between text-[10px] text-slate-500">
        <span>Set processing delay on all</span>
        <span class="font-mono text-slate-400">{cfg.processingDelayMs} ms</span>
      </span>
      <input
        type="range"
        min="0"
        max="5000"
        step="100"
        value={cfg.processingDelayMs}
        oninput={(e) => consumers.applyDelayToAll(Number(e.currentTarget.value))}
        class="w-full"
      />
    </label>

    <div class="space-y-2">
      {#each consumers.consumers as consumer (consumer.id)}
        <ConsumerControls
          {consumer}
          onPause={() => consumers.togglePause(consumer.id)}
          onRemove={() => consumers.removeConsumer(consumer.id)}
          onDelay={(ms) => consumers.setDelay(consumer.id, ms)}
        />
      {:else}
        <p
          class="rounded-lg border border-dashed border-ink-800 px-3 py-6 text-center text-[11px] text-slate-600"
        >
          {consumers.connected
            ? 'No consumers bound. Use + to add one.'
            : 'Connect to bind consumers to the queue.'}
        </p>
      {/each}
    </div>
  </div>
</section>
