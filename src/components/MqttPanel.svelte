<script>
  import Field from './Field.svelte'
  import StatusDot from './StatusDot.svelte'
  import { keyCss } from '../lib/keyColor.js'

  // Configuration only — the publisher's representation on the flow stage is
  // PublisherNode, so this panel owns no animation anchor.
  // `blockedReason`, when set, holds publishing back for a reason that belongs to
  // the other side of the demo — the Solace pre-flight drain would consume the
  // message before any consumer the user can see gets to.
  let { publisher, blockedReason = null } = $props()

  // `config` is a deeply-reactive $state object. Binding into its properties is
  // fine — only reassigning `cfg` itself would not be.
  let cfg = $derived(publisher.config)

  let locked = $derived(publisher.status === 'connected' || publisher.status === 'connecting')

  // Collapse the connection form on connect so the message controls are visible
  // without scrolling — those are the ones used repeatedly during a demo.
  let showConnection = $state(true)
  let wasConnected = false
  $effect(() => {
    if (publisher.connected && !wasConnected) showConnection = false
    if (!publisher.connected && wasConnected) showConnection = true
    wasConnected = publisher.connected
  })
</script>

<section
  class="flex h-full min-h-0 flex-col rounded-xl border border-ink-800 bg-ink-900/70 backdrop-blur"
>
  <header class="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
    <div>
      <h2 class="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <span class="h-2.5 w-2.5 rounded-sm bg-mqtt"></span>
        MQTT 5 Publisher
      </h2>
      <p class="mt-0.5 text-[11px] text-slate-500">mqtt.js · QoS 1 · User Properties</p>
    </div>
    <StatusDot status={publisher.status} />
  </header>

  <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
    <button
      onclick={() => (showConnection = !showConnection)}
      class="flex w-full items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase transition hover:text-slate-200"
    >
      <span class="inline-block transition-transform {showConnection ? 'rotate-90' : ''}">▸</span>
      Connection
    </button>

    {#if showConnection}
      <div class="space-y-2.5">
        <Field
          label="WebSocket URL"
          bind:value={cfg.url}
          disabled={locked}
          hint="ws://…:8000 · wss://…:8443"
          mono
        />
        <Field label="Client ID" bind:value={cfg.clientId} disabled={locked} mono />
        <div class="grid grid-cols-2 gap-2.5">
          <Field label="Username" bind:value={cfg.username} disabled={locked} />
          <Field
            label="Password"
            type="password"
            bind:value={cfg.password}
            disabled={locked}
            hint="not saved"
          />
        </div>
      </div>

      {#if publisher.error}
        <p
          class="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300"
        >
          {publisher.error}
        </p>
      {/if}

      <div class="flex gap-2">
        {#if publisher.connected || publisher.status === 'connecting'}
          <button
            onclick={() => publisher.disconnect()}
            class="flex-1 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
          >
            Disconnect
          </button>
        {:else}
          <button
            onclick={() => publisher.connect()}
            class="flex-1 rounded-md bg-mqtt/15 px-3 py-2 text-sm font-semibold text-mqtt ring-1 ring-mqtt/40 transition hover:bg-mqtt/25"
          >
            Connect
          </button>
        {/if}
      </div>
    {:else if publisher.error}
      <p class="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300">
        {publisher.error}
      </p>
    {/if}

    <hr class="border-ink-800" />

    <div class="space-y-2.5">
      <h3 class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Message</h3>
      <Field
        label="Topic template"
        bind:value={cfg.topicTemplate}
        hint="{'{key}'} is substituted"
        mono
      />
      <Field
        label="Partition key user property"
        bind:value={cfg.partitionKeyProperty}
        hint="Solace: QUEUE_PARTITION_KEY"
        mono
      />

      <div>
        <span class="mb-1 block text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          Partition key selection
        </span>
        <div class="flex gap-1 rounded-md border border-ink-800 bg-ink-950/60 p-1">
          {#each [['rotate', 'Rotate'], ['random', 'Random'], ['none', 'No key']] as [mode, label] (mode)}
            <button
              onclick={() => (cfg.keyMode = mode)}
              class="flex-1 rounded px-2 py-1 text-[11px] font-medium transition {cfg.keyMode ===
              mode
                ? 'bg-ink-800 text-slate-100'
                : 'text-slate-500 hover:text-slate-300'}"
            >
              {label}
            </button>
          {/each}
        </div>
        {#if cfg.keyMode === 'none'}
          <p class="mt-1.5 text-[10px] leading-snug text-amber-400/80">
            No key is sent. Solace assigns keyless messages to a random partition, so a partitioned
            queue will not show stickiness.
          </p>
        {/if}
      </div>

      {#if cfg.keyMode !== 'none'}
        <Field label="Keys (comma separated)" bind:value={cfg.partitionKeys} mono />
        <div class="flex flex-wrap gap-1">
          {#each publisher.keyList as key (key)}
            {@const c = keyCss(key)}
            <span
              class="rounded px-1.5 py-0.5 font-mono text-[10px]"
              style:color={c.fg}
              style:background={c.bg}
              style:border="1px solid {c.border}"
            >
              {key}
            </span>
          {/each}
        </div>
      {/if}

      <label class="block">
        <span class="mb-1 block text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          Payload (JSON)
        </span>
        <textarea
          bind:value={cfg.payload}
          rows="4"
          spellcheck="false"
          class="w-full resize-y rounded-md border border-ink-800 bg-ink-950/60 px-2.5 py-1.5 font-mono text-[12px] text-slate-100 outline-none transition focus:border-slate-500"
        ></textarea>
      </label>
      <p class="text-[10px] leading-snug text-slate-500">
        A <code class="text-slate-400">demoMsgId</code> and
        <code class="text-slate-400">partitionKey</code> field are added to the payload so each card
        can be matched to the message a consumer receives.
      </p>
    </div>
  </div>

  <footer class="space-y-2 border-t border-ink-800 px-4 py-3">
    <button
      onclick={() => publisher.publish()}
      disabled={!publisher.connected || !!blockedReason}
      class="w-full rounded-md bg-mqtt px-3 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-ink-800 disabled:text-slate-500"
    >
      {blockedReason && publisher.connected ? blockedReason : 'Publish QoS 1 message'}
    </button>
    <div class="flex justify-between text-[11px] text-slate-500">
      <span>{publisher.publishedCount} PUBACKed</span>
      {#if publisher.lastKey}
        <span class="font-mono">last key: {publisher.lastKey}</span>
      {/if}
    </div>
  </footer>
</section>
