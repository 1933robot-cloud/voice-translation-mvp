import { qs, setText, logFactory, randomId, SignalClient, statusClass } from './shared.js';

const roomId = qs('room');
const clientId = randomId();
const log = logFactory(document.getElementById('log'));

if (!roomId) {
  alert('Missing room id');
  location.href = '/';
}

setText('room-id', roomId);
setText('client-id', clientId);

const signalStatusEl = document.getElementById('signal-status');
const realtimeStatusEl = document.getElementById('realtime-status');
const micStateEl = document.getElementById('mic-state');
const listenersCountEl = document.getElementById('listeners-count');
const listenersListEl = document.getElementById('listeners-list');
const subtitlesEl = document.getElementById('subtitles');
const audioEl = document.getElementById('speaker-audio');

function setBadge(el, status) {
  el.textContent = status;
  el.className = statusClass(status);
}

let signalClient = null;
let realtimePc = null;
let realtimeDc = null;
let localStream = null;
let remoteEnglishStream = null;
let listeners = [];
let relays = new Map();
let subtitleState = { id: null, ru: '', en: '', ts: 0 };

function renderListeners() {
  listenersCountEl.textContent = String(listeners.length);
  listenersListEl.innerHTML = listeners.map((x) => `<li>${x.clientId}</li>`).join('');
}

function renderSubtitles() {
  const rows = [];
  if (subtitleState.id) rows.push(subtitleState);
  subtitlesEl.innerHTML = rows.length
    ? rows.map(r => `<div class="subtitle-item"><div class="time">${new Date(r.ts).toLocaleTimeString()}</div><div><strong>RU:</strong> ${escapeHtml(r.ru || '—')}</div><div style="margin-top:6px"><strong>EN:</strong> ${escapeHtml(r.en || '—')}</div></div>`).join('')
    : '<div class="small">No transcript yet.</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function finalizeSubtitle() {
  subtitleState = { id: null, ru: '', en: '', ts: 0 };
  renderSubtitles();
}

function updateSubtitle(patch) {
  if (!subtitleState.id) {
    subtitleState = { id: crypto.randomUUID(), ru: '', en: '', ts: Date.now() };
  }
  subtitleState = { ...subtitleState, ...patch };
  renderSubtitles();
}

function getRemoteStream() {
  return remoteEnglishStream;
}

async function connectToListener(listenerId) {
  if (!remoteEnglishStream) {
    log(`listener ${listenerId} is waiting for english stream`);
    return;
  }
  if (relays.has(listenerId)) return relays.get(listenerId);

  const pc = new RTCPeerConnection();
  relays.set(listenerId, pc);

  for (const track of remoteEnglishStream.getAudioTracks()) {
    pc.addTrack(track, remoteEnglishStream);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      signalClient.sendIceCandidate(listenerId, event.candidate.toJSON());
    }
  };

  pc.onconnectionstatechange = () => {
    log(`relay ${listenerId}: ${pc.connectionState}`);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signalClient.sendOffer(listenerId, offer);
  log(`offer sent to listener ${listenerId}`);
  return pc;
}

function replaceRelayStream(stream) {
  for (const pc of relays.values()) {
    const senders = pc.getSenders().filter((s) => s.track?.kind === 'audio');
    const track = stream.getAudioTracks()[0];
    if (!track) continue;
    if (!senders.length) {
      pc.addTrack(track, stream);
    } else {
      for (const sender of senders) {
        sender.replaceTrack(track).catch(() => {});
      }
    }
  }
}

async function startRealtime() {
  if (realtimePc) {
    log('realtime session already running');
    return;
  }

  try {
    setBadge(realtimeStatusEl, 'connecting');

    const tokenRes = await fetch('/api/realtime/token');
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.value) {
      throw new Error(tokenData.error || 'Failed to get realtime token');
    }

    const ephemeralKey = tokenData.value;
    realtimePc = new RTCPeerConnection();

    realtimePc.onconnectionstatechange = () => {
      const state = realtimePc.connectionState;
      setBadge(realtimeStatusEl, state);
      log(`realtime state=${state}`);
    };

    audioEl.autoplay = true;
    audioEl.playsInline = true;
    realtimePc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      remoteEnglishStream = stream;
      audioEl.srcObject = stream;
      audioEl.play().catch(() => log('local autoplay blocked'));
      replaceRelayStream(stream);
      for (const listener of listeners) {
        connectToListener(listener.clientId).catch((err) => log(`relay error: ${err.message}`));
      }
      log(`english audio stream attached, tracks=${stream.getAudioTracks().length}`);
    };

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    for (const track of localStream.getAudioTracks()) {
      realtimePc.addTrack(track, localStream);
    }

    micStateEl.textContent = 'on';

    realtimeDc = realtimePc.createDataChannel('oai-events');
    realtimeDc.addEventListener('open', () => {
      const event = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['audio', 'text'],
          instructions: [
            'You are a strict live interpreter.',
            'Input language is Russian.',
            'Output language is English.',
            'Do not answer as an assistant.',
            'Do not explain or add commentary.',
            'Translate faithfully and naturally.'
          ].join(' ')
        }
      };
      realtimeDc.send(JSON.stringify(event));
      log('session.update sent');
    });

    realtimeDc.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data);
        const type = event.type || 'unknown';
        if (type.includes('input_audio_transcription') && typeof event.transcript === 'string') {
          updateSubtitle({ ru: event.transcript, ts: Date.now() });
        }
        if ((type.includes('response.output_text') || type.includes('response.text')) && typeof event.delta === 'string') {
          updateSubtitle({ en: `${subtitleState.en || ''}${event.delta}`, ts: Date.now() });
        }
        if (type === 'response.done') {
          setTimeout(finalizeSubtitle, 600);
        }
      } catch {}
    });

    const offer = await realtimePc.createOffer();
    await realtimePc.setLocalDescription(offer);

    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp || ''
    });

    if (!sdpRes.ok) {
      const text = await sdpRes.text();
      throw new Error(`SDP exchange failed: ${sdpRes.status} ${text}`);
    }

    const answer = { type: 'answer', sdp: await sdpRes.text() };
    await realtimePc.setRemoteDescription(answer);
    setBadge(realtimeStatusEl, 'connected');
    log('realtime connected');
  } catch (error) {
    setBadge(realtimeStatusEl, 'failed');
    log(`start failed: ${error.message}`);
  }
}

function stopRealtime() {
  try { realtimeDc?.close(); } catch {}
  try { realtimePc?.close(); } catch {}
  realtimeDc = null;
  realtimePc = null;
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  micStateEl.textContent = 'off';
  setBadge(realtimeStatusEl, 'closed');
  log('realtime stopped');
}

function toggleMic() {
  if (!localStream) return;
  const next = !localStream.getAudioTracks()[0].enabled;
  localStream.getAudioTracks().forEach((t) => { t.enabled = next; });
  micStateEl.textContent = next ? 'on' : 'muted';
  log(next ? 'microphone unmuted' : 'microphone muted');
}

signalClient = new SignalClient({
  roomId,
  clientId,
  role: 'speaker',
  handlers: {
    onJoined: (msg) => {
      setBadge(signalStatusEl, 'joined');
      listeners = msg.peers.filter((p) => p.role === 'listener');
      renderListeners();
      for (const peer of listeners) {
        connectToListener(peer.clientId).catch((err) => log(`relay init error: ${err.message}`));
      }
      log(`joined room ${roomId} as speaker`);
    },
    onPeerJoined: (msg) => {
      if (msg.peer.role === 'listener') {
        listeners = [...listeners.filter((x) => x.clientId !== msg.peer.clientId), msg.peer];
        renderListeners();
        connectToListener(msg.peer.clientId).catch((err) => log(`relay peer error: ${err.message}`));
        log(`listener joined: ${msg.peer.clientId}`);
      }
    },
    onPeerLeft: (msg) => {
      listeners = listeners.filter((x) => x.clientId !== msg.clientId);
      const pc = relays.get(msg.clientId);
      if (pc) pc.close();
      relays.delete(msg.clientId);
      renderListeners();
      log(`peer left: ${msg.clientId}`);
    },
    onSignal: async (msg) => {
      if (msg.signal.type === 'answer') {
        const pc = relays.get(msg.from);
        if (pc) await pc.setRemoteDescription(msg.signal.sdp);
      }
      if (msg.signal.type === 'ice-candidate') {
        const pc = relays.get(msg.from);
        if (pc) {
          try { await pc.addIceCandidate(msg.signal.candidate); } catch {}
        }
      }
    },
    onError: (msg) => {
      log(`ws error: ${msg.message}`);
    }
  }
});

renderListeners();
setBadge(signalStatusEl, 'connecting');
setBadge(realtimeStatusEl, 'idle');
renderSubtitles();

document.getElementById('start-btn').addEventListener('click', startRealtime);
document.getElementById('stop-btn').addEventListener('click', stopRealtime);
document.getElementById('mute-btn').addEventListener('click', toggleMic);
document.getElementById('enable-audio').addEventListener('click', () => audioEl.play().catch(() => {}));

window.addEventListener('beforeunload', () => {
  stopRealtime();
  signalClient?.close();
  for (const pc of relays.values()) pc.close();
});
