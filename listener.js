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

const statusEl = document.getElementById('listener-status');
const speakerEl = document.getElementById('speaker-id');
const audioEl = document.getElementById('listener-audio');

function setBadge(status) {
  statusEl.textContent = status;
  statusEl.className = statusClass(status);
}

let signalClient = null;
let pc = null;
let currentSpeakerId = null;

function closePc() {
  if (pc) {
    try { pc.close(); } catch {}
    pc = null;
  }
}

async function ensurePc(remoteSpeakerId) {
  if (pc) return pc;
  currentSpeakerId = remoteSpeakerId;
  pc = new RTCPeerConnection();

  pc.onconnectionstatechange = () => {
    setBadge(pc.connectionState);
    log(`pc.state=${pc.connectionState}`);
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream) return;
    audioEl.srcObject = stream;
    audioEl.play().catch(() => log('autoplay blocked, tap Enable audio'));
    log(`english stream attached, tracks=${stream.getAudioTracks().length}`);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && currentSpeakerId) {
      signalClient.sendIceCandidate(currentSpeakerId, event.candidate.toJSON());
    }
  };

  return pc;
}

signalClient = new SignalClient({
  roomId,
  clientId,
  role: 'listener',
  handlers: {
    onJoined: async (msg) => {
      setBadge('joined');
      log(`joined room ${roomId} as listener`);
      const existingSpeaker = msg.peers.find((p) => p.role === 'speaker');
      if (existingSpeaker) {
        currentSpeakerId = existingSpeaker.clientId;
        speakerEl.textContent = existingSpeaker.clientId;
        await ensurePc(existingSpeaker.clientId);
        setBadge('waiting-speaker');
        log(`speaker present: ${existingSpeaker.clientId}`);
      } else {
        setBadge('waiting-speaker');
        log('waiting for speaker');
      }
    },
    onPeerJoined: async (msg) => {
      if (msg.peer.role === 'speaker') {
        currentSpeakerId = msg.peer.clientId;
        speakerEl.textContent = msg.peer.clientId;
        await ensurePc(msg.peer.clientId);
        setBadge('waiting-speaker');
        log(`speaker joined: ${msg.peer.clientId}`);
      }
    },
    onPeerLeft: (msg) => {
      if (msg.clientId === currentSpeakerId) {
        log(`speaker left: ${msg.clientId}`);
        currentSpeakerId = null;
        speakerEl.textContent = 'waiting';
        setBadge('waiting-speaker');
        audioEl.srcObject = null;
        closePc();
      }
    },
    onSignal: async (msg) => {
      if (msg.signal.type === 'offer') {
        await ensurePc(msg.from);
        await pc.setRemoteDescription(msg.signal.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalClient.sendAnswer(msg.from, answer);
        log(`answer sent to ${msg.from}`);
        return;
      }
      if (msg.signal.type === 'ice-candidate') {
        if (!pc) return;
        try { await pc.addIceCandidate(msg.signal.candidate); } catch {}
      }
    },
    onError: (msg) => {
      log(`ws error: ${msg.message}`);
    }
  }
});

setBadge('joining');
document.getElementById('enable-audio').addEventListener('click', () => audioEl.play().catch(() => {}));

window.addEventListener('beforeunload', () => {
  closePc();
  signalClient?.close();
});
