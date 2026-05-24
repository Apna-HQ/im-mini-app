'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectMessage, UserProfile } from '@apna/sdk';
import * as nip19 from 'nostr-tools/nip19';
import {
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  UserRound,
  Video,
  VideoOff,
} from 'lucide-react';

import { useApna } from './apna-provider';

const SIGNAL_KIND = 'im.call.signal';
const SIGNAL_VERSION = 1;
const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';

type CallSignalType =
  | 'invite'
  | 'accept'
  | 'reject'
  | 'hangup'
  | 'offer'
  | 'answer'
  | 'ice';

interface CallSignal {
  kind: typeof SIGNAL_KIND;
  version: typeof SIGNAL_VERSION;
  callId: string;
  type: CallSignalType;
  from: string;
  to: string;
  createdAt: number;
  media?: {
    audio: boolean;
    video: boolean;
  };
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

interface IncomingCall {
  callId: string;
  from: string;
  createdAt: number;
  media: {
    audio: boolean;
    video: boolean;
  };
}

type CallState = 'idle' | 'ready' | 'calling' | 'ringing' | 'connecting' | 'connected';

function App() {
  const { apna } = useApna();
  const [selfPubkey, setSelfPubkey] = useState('');
  const [selfProfile, setSelfProfile] = useState<UserProfile | null>(null);
  const [peerInput, setPeerInput] = useState('');
  const [peerPubkey, setPeerPubkey] = useState('');
  const [callId, setCallId] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [status, setStatus] = useState('Connecting to Apna capabilities...');
  const [error, setError] = useState('');
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraMuted, setCameraMuted] = useState(false);
  const [hasRemoteMedia, setHasRemoteMedia] = useState(false);
  const [wakeStatus, setWakeStatus] = useState('');

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<CallSignal | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const unsubscribeMessagesRef = useRef<(() => void) | null>(null);
  const selfPubkeyRef = useRef('');
  const peerPubkeyRef = useRef('');
  const callIdRef = useRef('');
  const videoEnabledRef = useRef(true);

  const sendSignal = useCallback(
    async (targetPubkey: string, partial: Omit<CallSignal, 'kind' | 'version' | 'from' | 'to' | 'createdAt' | 'callId'>) => {
      const activeSelf = selfPubkeyRef.current;
      const activeCallId = callIdRef.current;
      if (!activeSelf || !activeCallId) return;

      const signal: CallSignal = {
        kind: SIGNAL_KIND,
        version: SIGNAL_VERSION,
        callId: activeCallId,
        from: activeSelf,
        to: targetPubkey,
        createdAt: Date.now(),
        ...partial,
      };

      await apna.social.v1.sendDirectMessage(targetPubkey, JSON.stringify(signal));
    },
    [apna]
  );

  const createPeerConnection = useCallback(
    (targetPubkey: string) => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: DEFAULT_STUN_URL }],
      });

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void sendSignal(targetPubkey, {
          type: 'ice',
          candidate: event.candidate.toJSON(),
        });
      };

      pc.ontrack = (event) => {
        let stream = remoteStreamRef.current;
        if (!stream) {
          stream = new MediaStream();
          remoteStreamRef.current = stream;
        }
        if (!stream.getTracks().some((track) => track.id === event.track.id)) {
          stream.addTrack(event.track);
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
        setHasRemoteMedia(true);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCallState('connected');
          setStatus('Connected');
        } else if (pc.connectionState === 'failed') {
          setStatus('Connection failed. You can hang up and retry.');
        } else if (pc.connectionState === 'disconnected') {
          setStatus('Peer disconnected');
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [sendSignal]
  );

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  const resetCall = useCallback(
    (nextStatus = 'Ready') => {
      pcRef.current?.close();
      pcRef.current = null;
      remoteStreamRef.current = null;
      pendingOfferRef.current = null;
      queuedCandidatesRef.current = [];
      peerPubkeyRef.current = '';
      callIdRef.current = '';
      stopLocalMedia();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setPeerPubkey('');
      setCallId('');
      setIncomingCall(null);
      setHasRemoteMedia(false);
      setCallState('ready');
      setStatus(nextStatus);
      setWakeStatus('');
    },
    [stopLocalMedia]
  );

  const startLocalMedia = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not expose camera/microphone APIs.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: videoEnabledRef.current
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          }
        : false,
    });

    localStreamRef.current = stream;
    setMicMuted(false);
    setCameraMuted(!videoEnabledRef.current);
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  const addLocalTracks = useCallback((pc: RTCPeerConnection, stream: MediaStream) => {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  }, []);

  const flushQueuedCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;

    const candidates = queuedCandidatesRef.current;
    queuedCandidatesRef.current = [];
    for (const candidate of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const applyRemoteCandidate = useCallback(async (candidate?: RTCIceCandidateInit) => {
    if (!candidate) return;
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) {
      queuedCandidatesRef.current.push(candidate);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  const answerOffer = useCallback(
    async (signal: CallSignal) => {
      if (!signal.sdp) return;
      const pc = pcRef.current;
      if (!pc) return;

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp: signal.sdp })
      );
      await flushQueuedCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(signal.from, {
        type: 'answer',
        media: { audio: true, video: videoEnabledRef.current },
        sdp: answer.sdp ?? '',
      });
      setCallState('connecting');
      setStatus('Answer sent. Connecting...');
    },
    [flushQueuedCandidates, sendSignal]
  );

  const handleSignal = useCallback(
    (signal: CallSignal) => {
      const activeSelf = selfPubkeyRef.current;
      if (!activeSelf || signal.to !== activeSelf) return;
      if (signal.kind !== SIGNAL_KIND || signal.version !== SIGNAL_VERSION) return;

      if (signal.type === 'invite') {
        peerPubkeyRef.current = signal.from;
        callIdRef.current = signal.callId;
        setPeerPubkey(signal.from);
        setPeerInput(signal.from);
        setCallId(signal.callId);
        setIncomingCall({
          callId: signal.callId,
          from: signal.from,
          createdAt: signal.createdAt,
          media: signal.media ?? { audio: true, video: true },
        });
        setCallState('ringing');
        setStatus('Incoming call');
        return;
      }

      if (signal.callId !== callIdRef.current) return;

      if (signal.type === 'offer') {
        pendingOfferRef.current = signal;
        if (pcRef.current) {
          void answerOffer(signal).catch((err: Error) => setError(err.message));
        }
        return;
      }

      if (signal.type === 'accept') {
        setStatus('Peer accepted. Connecting...');
        setCallState('connecting');
        return;
      }

      if (signal.type === 'answer' && signal.sdp) {
        const pc = pcRef.current;
        if (!pc) return;
        void pc
          .setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
          )
          .then(flushQueuedCandidates)
          .then(() => {
            setCallState('connecting');
            setStatus('Answer received. Connecting...');
          })
          .catch((err: Error) => setError(err.message));
        return;
      }

      if (signal.type === 'ice') {
        void applyRemoteCandidate(signal.candidate).catch((err: Error) =>
          setError(err.message)
        );
        return;
      }

      if (signal.type === 'reject') {
        resetCall('Call declined');
        return;
      }

      if (signal.type === 'hangup') {
        resetCall('Call ended');
      }
    },
    [answerOffer, applyRemoteCandidate, flushQueuedCandidates, resetCall]
  );

  const handleDirectMessage = useCallback(
    (message: DirectMessage) => {
      const text = message.plaintext;
      if (!text) return;
      const signal = parseSignal(text);
      if (signal) handleSignal(signal);
    },
    [handleSignal]
  );

  useEffect(() => {
    let disposed = false;

    async function boot() {
      setError('');
      try {
        await apna.permissions.request([
          'identity.v1.activePubkey',
          'identity.v1.me',
          'social.v1.messages',
          'social.v1.sendDirectMessage',
          'social.v1.subscribeMessages',
        ]);

        const pubkey = await apna.identity.v1.activePubkey();
        const profile = await apna.identity.v1.me().catch(() => null);
        if (disposed) return;

        selfPubkeyRef.current = pubkey;
        setSelfPubkey(pubkey);
        setSelfProfile(profile);

        const params = new URLSearchParams(window.location.search);
        const peer = params.get('peer');
        const routeCallId = params.get('callId');
        if (peer) setPeerInput(peer);
        if (routeCallId) {
          callIdRef.current = routeCallId;
          setCallId(routeCallId);
          setStatus('Looking for pending call invite...');
        }

        const since = Math.floor(Date.now() / 1000) - 60 * 60;
        const stop = apna.social.v1.subscribeMessages({ since }, handleDirectMessage);
        unsubscribeMessagesRef.current = stop;

        const messages = await apna.social.v1.messages({ since, limit: 100 }).catch(() => []);
        if (disposed) return;
        messages.forEach(handleDirectMessage);
        setCallState((current) => (current === 'idle' ? 'ready' : current));
        if (!routeCallId) setStatus('Ready');
      } catch (err) {
        if (!disposed) {
          setError((err as Error).message);
          setStatus('Setup failed');
        }
      }
    }

    void boot();

    return () => {
      disposed = true;
      unsubscribeMessagesRef.current?.();
      resetCall('Disconnected');
    };
  }, [apna, handleDirectMessage, resetCall]);

  async function dial() {
    setError('');
    setWakeStatus('');
    try {
      const target = normalizeRecipient(peerInput);
      const nextCallId = crypto.randomUUID();
      peerPubkeyRef.current = target;
      callIdRef.current = nextCallId;
      setPeerPubkey(target);
      setCallId(nextCallId);
      setIncomingCall(null);
      setCallState('calling');
      setStatus('Requesting microphone and camera...');

      const stream = await startLocalMedia();
      const pc = createPeerConnection(target);
      addLocalTracks(pc, stream);

      await sendSignal(target, {
        type: 'invite',
        media: { audio: true, video: videoEnabled },
      });
      void wakeCounterparty(target, nextCallId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(target, {
        type: 'offer',
        media: { audio: true, video: videoEnabled },
        sdp: offer.sdp ?? '',
      });
      setStatus('Calling...');
    } catch (err) {
      setError((err as Error).message);
      resetCall('Ready');
    }
  }

  async function acceptCall() {
    if (!incomingCall) return;
    setError('');
    try {
      const target = incomingCall.from;
      peerPubkeyRef.current = target;
      callIdRef.current = incomingCall.callId;
      setPeerPubkey(target);
      setCallId(incomingCall.callId);
      setCallState('connecting');
      setStatus('Requesting microphone and camera...');

      const stream = await startLocalMedia();
      const pc = createPeerConnection(target);
      addLocalTracks(pc, stream);
      await sendSignal(target, {
        type: 'accept',
        media: { audio: true, video: videoEnabledRef.current },
      });

      if (pendingOfferRef.current) {
        await answerOffer(pendingOfferRef.current);
      } else {
        setStatus('Accepted. Waiting for offer...');
      }
    } catch (err) {
      setError((err as Error).message);
      resetCall('Ready');
    }
  }

  async function rejectCall() {
    if (incomingCall) {
      await sendSignal(incomingCall.from, { type: 'reject' }).catch(() => undefined);
    }
    resetCall('Call declined');
  }

  async function hangUp() {
    const target = peerPubkeyRef.current;
    if (target && callIdRef.current) {
      await sendSignal(target, { type: 'hangup' }).catch(() => undefined);
    }
    resetCall('Call ended');
  }

  function toggleMic() {
    const nextMuted = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
  }

  function toggleCamera() {
    const nextMuted = !cameraMuted;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setCameraMuted(nextMuted);
  }

  function handleVideoMode(enabled: boolean) {
    videoEnabledRef.current = enabled;
    setVideoEnabled(enabled);
  }

  async function wakeCounterparty(targetPubkey: string, activeCallId: string) {
    const wakeApiUrl =
      process.env.NEXT_PUBLIC_WAKE_API_URL || '/api/calls/wake';
    if (!wakeApiUrl) {
      setWakeStatus('Wake backend not configured; foreground signaling still works.');
      return;
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const hostOrigin =
      process.env.NEXT_PUBLIC_HOST_APP_ORIGIN || window.location.origin;
    const callerName = profileName(selfProfile) || shortPubkey(selfPubkeyRef.current);
    const miniAppUrl = `${appUrl}?callId=${encodeURIComponent(activeCallId)}&peer=${encodeURIComponent(
      selfPubkeyRef.current
    )}`;
    const deepLink = `${hostOrigin.replace(/\/+$/, '')}/app?appId=im-mini-app&appUrl=${encodeURIComponent(
      miniAppUrl
    )}&defaultDisplay=fullscreen`;

    try {
      const response = await fetch(wakeApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetPubkey,
          callId: activeCallId,
          callerPubkey: selfPubkeyRef.current,
          callerName,
          url: deepLink,
          media: { audio: true, video: videoEnabledRef.current },
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Wake push failed with HTTP ${response.status}`);
      }

      setWakeStatus('Wake push requested');
    } catch (err) {
      setWakeStatus((err as Error).message);
    }
  }

  const canDial = callState === 'ready' && peerInput.trim().length > 0;
  const inCall = callState === 'calling' || callState === 'connecting' || callState === 'connected';

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Apna mini-app</p>
          <h1>IM Calls</h1>
        </div>
        <div className="identity-pill" title={selfPubkey || 'Connecting'}>
          <UserRound size={16} />
          <span>{profileName(selfProfile) || shortPubkey(selfPubkey) || 'Connecting'}</span>
        </div>
      </section>

      <section className="stage" aria-label="Call video stage">
        <div className={hasRemoteMedia ? 'remote-pane has-remote-media' : 'remote-pane'}>
          <video ref={remoteVideoRef} autoPlay playsInline className="video" />
          <div className="remote-placeholder">
            <PhoneCall size={32} />
            <span>{remoteLabel(callState, peerPubkey, incomingCall)}</span>
          </div>
        </div>
        <div className="local-preview">
          <video ref={localVideoRef} autoPlay playsInline muted className="video" />
          <span>{cameraMuted ? 'Camera off' : 'You'}</span>
        </div>
      </section>

      <section className="controls-band">
        <div className="dial-panel">
          <label htmlFor="peer">Call recipient</label>
          <div className="dial-row">
            <input
              id="peer"
              value={peerInput}
              onChange={(event) => setPeerInput(event.target.value)}
              placeholder="npub... or 64-char pubkey"
              disabled={callState !== 'ready'}
            />
            <button type="button" className="primary-button" onClick={dial} disabled={!canDial}>
              <Phone size={18} />
              <span>Dial</span>
            </button>
          </div>
          <p className="fine-print">Signaling is encrypted through Apna social DMs. Media stays peer-to-peer.</p>
        </div>

        <div className="media-actions" aria-label="Call controls">
          <button type="button" onClick={toggleMic} disabled={!inCall} title="Toggle microphone">
            {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button type="button" onClick={toggleCamera} disabled={!inCall || !videoEnabled} title="Toggle camera">
            {cameraMuted ? <VideoOff size={20} /> : <Video size={20} />}
          </button>
          <button type="button" onClick={() => handleVideoMode(!videoEnabled)} disabled={callState !== 'ready'} title="Video mode">
            {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <button type="button" className="danger-button" onClick={hangUp} disabled={!inCall} title="Hang up">
            <PhoneOff size={20} />
          </button>
        </div>
      </section>

      {incomingCall && callState === 'ringing' && (
        <section className="incoming-strip">
          <div>
            <p className="eyebrow">Incoming call</p>
            <h2>{shortPubkey(incomingCall.from)}</h2>
          </div>
          <div className="incoming-actions">
            <button type="button" className="secondary-button" onClick={rejectCall}>
              <PhoneOff size={18} />
              <span>Decline</span>
            </button>
            <button type="button" className="primary-button" onClick={acceptCall}>
              <PhoneCall size={18} />
              <span>Accept</span>
            </button>
          </div>
        </section>
      )}

      <section className="status-grid">
        <div className="status-item">
          <span>State</span>
          <strong>{callState}</strong>
        </div>
        <div className="status-item">
          <span>Call ID</span>
          <strong>{callId ? callId.slice(0, 8) : 'none'}</strong>
        </div>
        <div className="status-item">
          <span>Wake</span>
          <strong>{wakeStatus || 'idle'}</strong>
        </div>
        <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          <span>Reload</span>
        </button>
      </section>

      {(status || error) && (
        <section className={error ? 'notice error' : 'notice'}>
          {error || status}
        </section>
      )}
    </main>
  );
}

export default App;

function parseSignal(text: string): CallSignal | null {
  try {
    const parsed = JSON.parse(text) as Partial<CallSignal>;
    if (
      parsed.kind !== SIGNAL_KIND ||
      parsed.version !== SIGNAL_VERSION ||
      typeof parsed.callId !== 'string' ||
      typeof parsed.type !== 'string' ||
      typeof parsed.from !== 'string' ||
      typeof parsed.to !== 'string'
    ) {
      return null;
    }
    return parsed as CallSignal;
  } catch {
    return null;
  }
}

function normalizeRecipient(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

  if (trimmed.startsWith('npub')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub' && typeof decoded.data === 'string') {
      return decoded.data.toLowerCase();
    }
  }

  throw new Error('Recipient must be an npub or 64-character hex pubkey.');
}

function shortPubkey(pubkey: string): string {
  if (!pubkey) return '';
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`;
}

function profileName(profile: UserProfile | null): string {
  const metadata = profile?.metadata;
  const name = metadata?.display_name || metadata?.name;
  return typeof name === 'string' ? name : '';
}

function remoteLabel(
  callState: CallState,
  peerPubkey: string,
  incomingCall: IncomingCall | null
): string {
  if (incomingCall && callState === 'ringing') return 'Incoming call';
  if (callState === 'calling') return `Calling ${shortPubkey(peerPubkey)}`;
  if (callState === 'connecting') return 'Connecting media';
  if (callState === 'connected') return 'Connected';
  return 'No active call';
}
