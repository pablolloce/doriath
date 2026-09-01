import { EventEmitter } from "node:events";

/**
 * Bus de eventos del servidor. Cada evento lleva un `channel` (chat:<id>, run:<id>, analyze:<id>, global)
 * y se reenvía a los clientes SSE suscritos. También se conserva un pequeño búfer por canal para que
 * una pestaña que se conecta tarde vea los últimos eventos.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
    this.buffers = new Map();
    this.sequence = 0;
  }

  publish(channel, type, data = {}) {
    this.sequence += 1;
    const event = { id: this.sequence, channel, type, data, at: new Date().toISOString() };
    const buffer = this.buffers.get(channel) || [];
    buffer.push(event);
    if (buffer.length > 200) buffer.splice(0, buffer.length - 200);
    this.buffers.set(channel, buffer);
    this.emit("event", event);
    return event;
  }

  recent(channel) {
    return this.buffers.get(channel) || [];
  }

  clear(channel) {
    this.buffers.delete(channel);
  }
}

export const eventBus = new EventBus();
