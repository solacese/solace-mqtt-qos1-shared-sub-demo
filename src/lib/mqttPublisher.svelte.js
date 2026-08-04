/**
 * The MQTT 5 side of the demo: a QoS 1 publisher.
 *
 * Two details are load-bearing for the point being demonstrated:
 *
 *  - `protocolVersion: 5` — MQTT 5 is what gives us User Properties, which is
 *    how a partition key can be attached to a message from an MQTT client.
 *  - `qos: 1` — Solace maps QoS 1 to its Guaranteed delivery mode. Without it
 *    the message is direct-only and never lands in the queue the Solace
 *    consumers are bound to, so nothing would arrive on the right-hand side.
 */

import mqtt from 'mqtt'
import { load, save, randomSuffix } from './persist.js'

export const MQTT_DEFAULTS = {
  url: 'ws://localhost:8000',
  clientId: `mqtt-pub-${randomSuffix()}`,
  username: 'default',
  password: '',
  topicTemplate: 'orders/{key}/created',
  partitionKeyProperty: 'QUEUE_PARTITION_KEY',
  partitionKeys: 'order-1, order-2, order-3, order-4',
  keyMode: 'rotate', // 'rotate' | 'random' | 'none'
  payload: '{\n  "item": "widget",\n  "qty": 3\n}',
}

export class MqttPublisher {
  config = $state(load('mqtt', MQTT_DEFAULTS))
  status = $state('disconnected') // disconnected | connecting | connected | error
  error = $state(null)
  publishedCount = $state(0)
  lastKey = $state(null)

  #client = null
  #keyIndex = 0
  #log
  #flow

  constructor({ log, flow }) {
    this.#log = log
    this.#flow = flow
  }

  get connected() {
    return this.status === 'connected'
  }

  /** Keys as a clean array, derived from the comma-separated field. */
  get keyList() {
    return this.config.partitionKeys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  }

  connect() {
    if (this.#client) this.disconnect()
    save('mqtt', this.config)
    this.status = 'connecting'
    this.error = null

    const { url, clientId, username, password } = this.config
    this.#log.info('mqtt', `Connecting to ${url} as MQTT 5 client "${clientId}"`)

    let client
    try {
      client = mqtt.connect(url, {
        protocolVersion: 5,
        clientId,
        username: username || undefined,
        password: password || undefined,
        clean: true,
        reconnectPeriod: 0, // Explicit connect/disconnect only — this is a demo control panel.
        connectTimeout: 8000,
        properties: {
          // A pure publisher needs no session state kept for it after it leaves.
          sessionExpiryInterval: 0,
        },
      })
    } catch (e) {
      this.status = 'error'
      this.error = e.message
      this.#log.error('mqtt', `Could not start client: ${e.message}`)
      return
    }

    this.#client = client

    client.on('connect', (packet) => {
      this.status = 'connected'
      this.error = null
      // MQTT 5 CONNACK can carry broker-imposed limits worth surfacing: if the
      // broker refuses QoS 1 the whole demo silently degrades, so say so loudly.
      const max = packet?.properties?.maximumQoS
      this.#log.ok('mqtt', `Connected (MQTT 5)${max !== undefined ? `, broker maximum QoS ${max}` : ''}`)
      if (max !== undefined && max < 1) {
        this.#log.warn(
          'mqtt',
          'Broker advertises maximum QoS 0 — QoS 1 publishes will be downgraded and will NOT reach a queue. Enable Guaranteed messaging on the message VPN.'
        )
      }
    })

    client.on('error', (e) => {
      this.status = 'error'
      this.error = e.message
      this.#log.error('mqtt', `${e.message}`)
    })

    client.on('close', () => {
      if (this.status !== 'error') this.status = 'disconnected'
    })

    client.on('disconnect', (packet) => {
      this.#log.warn('mqtt', `Broker sent DISCONNECT (reason ${packet?.reasonCode ?? '?'})`)
    })
  }

  disconnect() {
    const client = this.#client
    this.#client = null
    if (client) {
      client.end(true)
      this.#log.info('mqtt', 'Disconnected')
    }
    this.status = 'disconnected'
  }

  /** Next partition key according to the selected mode. */
  #nextKey() {
    if (this.config.keyMode === 'none') return null
    const keys = this.keyList
    if (!keys.length) return null
    if (this.config.keyMode === 'random') {
      return keys[Math.floor(Math.random() * keys.length)]
    }
    const key = keys[this.#keyIndex % keys.length]
    this.#keyIndex++
    return key
  }

  /**
   * Publish one message. Returns the packet registered with the flow store, or
   * null if we weren't in a position to publish.
   */
  publish() {
    if (!this.#client || this.status !== 'connected') {
      this.#log.warn('mqtt', 'Not connected — nothing published')
      return null
    }

    const key = this.#nextKey()
    this.lastKey = key
    const id = this.#flow.nextId()
    const topic = this.config.topicTemplate.replaceAll('{key}', key ?? 'nokey')

    // The correlation id goes in the payload, not only in a user property. The
    // payload always survives the MQTT->SMF hop; user-property mapping is the
    // very thing this demo is inspecting, so it cannot be the thing we depend on.
    let body
    try {
      const parsed = JSON.parse(this.config.payload)
      body = JSON.stringify({ ...parsed, demoMsgId: id, partitionKey: key })
    } catch {
      // Not JSON: keep the user's bytes verbatim and wrap the id around them, so
      // an arbitrary payload still works and is still correlatable.
      body = JSON.stringify({ demoMsgId: id, partitionKey: key, raw: this.config.payload })
      this.#log.warn('mqtt', 'Payload is not valid JSON — sent as a "raw" string field')
    }

    const userProperties = { demoMsgId: id }
    if (key) userProperties[this.config.partitionKeyProperty] = key

    const packet = this.#flow.publish({
      id,
      key,
      topic,
      payload: body,
      size: body.length,
    })

    this.#client.publish(
      topic,
      body,
      { qos: 1, retain: false, properties: { userProperties } },
      (err) => {
        // QoS 1: this callback fires on PUBACK, i.e. the broker has accepted
        // ownership of the message. That is the honest moment to show it landing
        // on the queue.
        if (err) {
          this.#flow.publishFailed(id, err.message)
          this.#log.error('mqtt', `Publish failed: ${err.message}`)
          return
        }
        this.publishedCount++
        this.#flow.acked(id)
      }
    )

    this.#log.info(
      'mqtt',
      `PUBLISH qos1 ${topic}${key ? ` [${this.config.partitionKeyProperty}=${key}]` : ' (no partition key)'}`
    )
    return packet
  }
}
