export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function logFactory(el, max = 60) {
  const items = [];
  return function log(line) {
    items.unshift(`${new Date().toLocaleTimeString()}  ${line}`);
    if (items.length > max) items.length = max;
    el.textContent = items.join('\n');
  };
}

export function randomId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

export class SignalClient {
  constructor({ roomId, clientId, role, handlers = {} }) {
    this.roomId = roomId;
    this.clientId = clientId;
    this.role = role;
    this.handlers = handlers;
    this.ws = new WebSocket(wsUrl('/ws/rooms'));

    this.ws.addEventListener('open', () => {
      this.send({ type: 'join', roomId, clientId, role });
    });

    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') this.handlers.onJoined?.(msg);
      if (msg.type === 'peer-joined') this.handlers.onPeerJoined?.(msg);
      if (msg.type === 'peer-left') this.handlers.onPeerLeft?.(msg);
      if (msg.type === 'signal') this.handlers.onSignal?.(msg);
      if (msg.type === 'error') this.handlers.onError?.(msg);
    });
  }

  send(payload) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  sendOffer(to, sdp) {
    this.send({ type: 'signal', roomId: this.roomId, from: this.clientId, to, signal: { type: 'offer', sdp } });
  }

  sendAnswer(to, sdp) {
    this.send({ type: 'signal', roomId: this.roomId, from: this.clientId, to, signal: { type: 'answer', sdp } });
  }

  sendIceCandidate(to, candidate) {
    this.send({ type: 'signal', roomId: this.roomId, from: this.clientId, to, signal: { type: 'ice-candidate', candidate } });
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave', roomId: this.roomId, clientId: this.clientId });
    }
    this.ws.close();
  }
}

export function statusClass(status) {
  if (["connected", "joined", "active", "ok"].includes(status)) return 'badge ok';
  if (["failed", "closed", "disconnected", "error"].includes(status)) return 'badge bad';
  return 'badge warn';
}
