import { errorMessage } from './format.js';

export class NetError extends Error {
  constructor(code) {
    super(errorMessage(code));
    this.code = code;
  }
}

// Thin wrapper around the socket.io client: promise-based requests and a few named events.
export class Net {
  constructor(createSocket) {
    this.createSocket = createSocket;
    this.socket = null;
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  fire(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  get online() {
    return this.socket?.connected === true;
  }

  connect() {
    if (this.socket) return;
    const socket = this.createSocket();
    this.socket = socket;
    socket.on('connect', () => this.fire('status', 'online'));
    socket.on('disconnect', () => this.fire('status', 'offline'));
    socket.on('connect_error', (err) => {
      const code = err?.message;
      if (code === 'auth_required' || code === 'too_many_connections') this.fire('refused', code);
      else this.fire('status', 'offline');
    });
    for (const event of ['hello', 'state', 'chat', 'chat:history']) socket.on(event, (payload) => this.fire(event, payload));
  }

  request(event, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.online) {
        reject(new NetError('offline'));
        return;
      }
      this.socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) reject(new NetError('timeout'));
        else if (!res?.ok) reject(new NetError(res?.error ?? 'internal'));
        else resolve(res);
      });
    });
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}
