/**
 * Event log. Both clients report through this rather than console.error, because
 * when this app is being demonstrated the browser console is not on screen — and
 * a connection failure that produces no visible output looks like a broken app
 * rather than a misconfigured broker.
 */

const MAX_ENTRIES = 300
let seq = 0

export class LogStore {
  entries = $state([])

  #push(level, source, message) {
    this.entries.push({
      id: ++seq,
      level,
      source,
      message,
      at: new Date().toLocaleTimeString(),
    })
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    }
  }

  info(source, message) {
    this.#push('info', source, message)
  }
  ok(source, message) {
    this.#push('ok', source, message)
  }
  warn(source, message) {
    this.#push('warn', source, message)
  }
  error(source, message) {
    this.#push('error', source, message)
  }

  clear() {
    this.entries = []
  }
}
