'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DirectMessage, UserProfile } from '@apna/sdk';
import * as nip19 from 'nostr-tools/nip19';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Camera,
  Check,
  ContactRound,
  Copy,
  Keyboard,
  MessageCircle,
  Mic,
  MicOff,
  Moon,
  MoreVertical,
  Paperclip,
  Phone,
  PhoneCall,
  PhoneOff,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Share2,
  Smile,
  Sun,
  Video,
  VideoOff,
  X,
} from 'lucide-react';

import { useApna } from './apna-provider';

const SIGNAL_KIND = 'im.call.signal';
const SIGNAL_VERSION = 1;
const SETTINGS_D_TAG = 'im-mini-app.contacts.v1';
const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';
const CONTACTS_STORAGE_PREFIX = 'im-mini-app.contacts.v1';
const CALLS_STORAGE_PREFIX = 'im-mini-app.calls.v1';
const CALL_INVITE_TTL_MS = 2 * 60 * 1000;
const QUICK_EMOJIS = ['👍', '🙏', '😂', '❤️', '🔥', '🎉', '👀', '✅'];

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

interface Contact {
  pubkey: string;
  npub: string;
  label: string;
  addedAt: number;
  source: 'manual' | 'qr' | 'dm' | 'nostr';
}

interface ChatMessage {
  id: string;
  peerPubkey: string;
  fromPubkey: string;
  content: string;
  createdAt: number;
  outgoing: boolean;
  pending?: boolean;
}

interface CallLog {
  callId: string;
  peerPubkey: string;
  direction: 'incoming' | 'outgoing';
  media: {
    audio: boolean;
    video: boolean;
  };
  status: 'missed' | 'declined' | 'answered' | 'ended';
  createdAt: number;
  updatedAt: number;
}

interface BarcodeDetectorShape {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorShape;
type CallState = 'idle' | 'ready' | 'calling' | 'ringing' | 'connecting' | 'connected';
type AppTab = 'chats' | 'calls' | 'contacts';

function App() {
  const { apna, theme, toggleTheme } = useApna();
  const [selfPubkey, setSelfPubkey] = useState('');
  const [selfProfile, setSelfProfile] = useState<UserProfile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedPubkey, setSelectedPubkey] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [contactDraftName, setContactDraftName] = useState('');
  const [contactDraftKey, setContactDraftKey] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('');
  const [showMyQr, setShowMyQr] = useState(false);
  const [myQrDataUrl, setMyQrDataUrl] = useState('');
  const [qrCopyStatus, setQrCopyStatus] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('chats');
  const [chatOpen, setChatOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [profilesByPubkey, setProfilesByPubkey] = useState<Record<string, UserProfile>>({});
  const [callId, setCallId] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [status, setStatus] = useState('Connecting to Apna capabilities...');
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('Contacts are local');
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraMuted, setCameraMuted] = useState(false);
  const [hasRemoteMedia, setHasRemoteMedia] = useState(false);
  const [wakeStatus, setWakeStatus] = useState('');

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<CallSignal | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const unsubscribeMessagesRef = useRef<(() => void) | null>(null);
  const selfPubkeyRef = useRef('');
  const peerPubkeyRef = useRef('');
  const callIdRef = useRef('');
  const videoEnabledRef = useRef(true);
  const messagesRef = useRef(new Map<string, ChatMessage>());
  const contactsRef = useRef<Contact[]>([]);
  const callLogsRef = useRef(new Map<string, CallLog>());
  const callStateRef = useRef<CallState>('idle');
  const incomingCallIdRef = useRef('');

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.pubkey === selectedPubkey) ?? null,
    [contacts, selectedPubkey]
  );

  const visibleContacts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) => {
      const profile = profilesByPubkey[contact.pubkey] ?? null;
      const metadataText = profileSearchText(profile);
      return (
        contact.label.toLowerCase().includes(query) ||
        contact.npub.toLowerCase().includes(query) ||
        contact.pubkey.includes(query) ||
        metadataText.includes(query)
      );
    });
  }, [contacts, profilesByPubkey, searchQuery]);

  const tabContacts = useMemo(() => {
    if (activeTab === 'calls') {
      const byPubkey = new Map(visibleContacts.map((contact) => [contact.pubkey, contact]));
      return latestCalls(callLogs)
        .map((call) => byPubkey.get(call.peerPubkey))
        .filter((contact): contact is Contact => Boolean(contact));
    }
    return visibleContacts;
  }, [activeTab, callLogs, visibleContacts]);

  const activeMessages = useMemo(
    () => messages.filter((message) => message.peerPubkey === selectedPubkey),
    [messages, selectedPubkey]
  );

  const selfNpub = useMemo(
    () => (selfPubkey ? nip19.npubEncode(selfPubkey) : ''),
    [selfPubkey]
  );

  const selectedProfile = selectedPubkey ? profilesByPubkey[selectedPubkey] ?? null : null;

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    incomingCallIdRef.current = incomingCall?.callId ?? '';
  }, [incomingCall]);

  const displayNameForContact = useCallback(
    (contact: Contact) => profileName(profilesByPubkey[contact.pubkey] ?? null) || contact.label,
    [profilesByPubkey]
  );

  const renderAvatar = useCallback(
    (
      label: string,
      profile: UserProfile | null | undefined,
      className = 'avatar'
    ) => {
      const picture = profilePicture(profile ?? null);
      return (
        <div className={className}>
          {picture ? <img src={picture} alt={label} /> : <span>{initials(label)}</span>}
        </div>
      );
    },
    []
  );

  const saveContacts = useCallback(
    (nextContacts: Contact[]) => {
      const sorted = sortContacts(nextContacts, messagesRef.current);
      contactsRef.current = sorted;
      setContacts(sorted);
      if (selfPubkeyRef.current) {
        window.localStorage.setItem(
          contactsStorageKey(selfPubkeyRef.current),
          JSON.stringify(sorted)
        );
      }
    },
    []
  );

  const upsertContact = useCallback(
    (pubkey: string, label?: string, source: Contact['source'] = 'dm') => {
      const normalized = normalizeRecipient(pubkey);
      setContacts((current) => {
        const existing = current.find((contact) => contact.pubkey === normalized);
        const next = existing
          ? current.map((contact) =>
              contact.pubkey === normalized
                ? {
                    ...contact,
                    label: label?.trim() || contact.label,
                    source: contact.source === 'dm' ? source : contact.source,
                  }
                : contact
            )
          : [
              ...current,
              {
                pubkey: normalized,
                npub: nip19.npubEncode(normalized),
                label: label?.trim() || shortPubkey(normalized),
                addedAt: Date.now(),
                source,
              },
            ];
        const sorted = sortContacts(next, messagesRef.current);
        contactsRef.current = sorted;
        if (selfPubkeyRef.current) {
          window.localStorage.setItem(
            contactsStorageKey(selfPubkeyRef.current),
            JSON.stringify(sorted)
          );
        }
        return sorted;
      });
      return normalized;
    },
    []
  );

  const saveCallLogs = useCallback((nextLogs: CallLog[]) => {
    const sorted = nextLogs.sort((a, b) => b.updatedAt - a.updatedAt);
    callLogsRef.current = new Map(sorted.map((log) => [log.callId, log]));
    setCallLogs(sorted);
    if (selfPubkeyRef.current) {
      window.localStorage.setItem(callsStorageKey(selfPubkeyRef.current), JSON.stringify(sorted));
    }
  }, []);

  const upsertCallLog = useCallback(
    (log: CallLog) => {
      const existing = callLogsRef.current.get(log.callId);
      const next = {
        ...existing,
        ...log,
        updatedAt: Math.max(existing?.updatedAt ?? 0, log.updatedAt),
      };
      callLogsRef.current.set(log.callId, next);
      saveCallLogs(Array.from(callLogsRef.current.values()));
    },
    [saveCallLogs]
  );

  const fetchContactProfile = useCallback(
    async (pubkey: string) => {
      if (!pubkey || profilesByPubkey[pubkey]) return;
      try {
        const profile = await apna.social.v1.userProfile(pubkey);
        setProfilesByPubkey((current) => ({ ...current, [pubkey]: profile }));
      } catch {
        // Profiles are nice-to-have; DMs and calls still work without metadata.
      }
    },
    [apna, profilesByPubkey]
  );

  const addChatMessage = useCallback(
    (message: ChatMessage) => {
      const existing = messagesRef.current.get(message.id);
      messagesRef.current.set(message.id, existing ? { ...existing, ...message } : message);
      const nextMessages = Array.from(messagesRef.current.values()).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      setMessages(nextMessages);
      contactsRef.current = sortContacts(contactsRef.current, messagesRef.current);
      setContacts(contactsRef.current);
      upsertContact(message.peerPubkey, undefined, 'dm');
    },
    [upsertContact]
  );

  const sendSignal = useCallback(
    async (
      targetPubkey: string,
      partial: Omit<
        CallSignal,
        'kind' | 'version' | 'from' | 'to' | 'createdAt' | 'callId'
      >
    ) => {
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
          setStatus('Connection failed. Hang up and retry.');
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
        const isExpectedWakeInvite = callIdRef.current === signal.callId;
        const isFreshInvite = Date.now() - signal.createdAt <= CALL_INVITE_TTL_MS;
        if (!isExpectedWakeInvite && !isFreshInvite) return;
        if (incomingCallIdRef.current === signal.callId || callStateRef.current === 'ringing') return;
        peerPubkeyRef.current = signal.from;
        callIdRef.current = signal.callId;
        setSelectedPubkey(signal.from);
        setCallId(signal.callId);
        setIncomingCall({
          callId: signal.callId,
          from: signal.from,
          createdAt: signal.createdAt,
          media: signal.media ?? { audio: true, video: true },
        });
        upsertContact(signal.from, undefined, 'dm');
        upsertCallLog({
          callId: signal.callId,
          peerPubkey: signal.from,
          direction: 'incoming',
          media: signal.media ?? { audio: true, video: true },
          status: 'missed',
          createdAt: signal.createdAt,
          updatedAt: signal.createdAt,
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
        const existing = callLogsRef.current.get(signal.callId);
        if (existing) upsertCallLog({ ...existing, status: 'declined', updatedAt: signal.createdAt });
        resetCall('Call declined');
        return;
      }

      if (signal.type === 'hangup') {
        const existing = callLogsRef.current.get(signal.callId);
        if (existing) upsertCallLog({ ...existing, status: 'ended', updatedAt: signal.createdAt });
        resetCall('Call ended');
      }
    },
    [
      answerOffer,
      applyRemoteCandidate,
      flushQueuedCandidates,
      resetCall,
      upsertCallLog,
      upsertContact,
    ]
  );

  const handleDirectMessage = useCallback(
    (message: DirectMessage) => {
      const text = message.plaintext;
      if (!text) return;

      const signal = parseSignal(text);
      if (signal) {
        handleSignal(signal);
        return;
      }

      const peerPubkey = inferMessagePeer(message, selfPubkeyRef.current);
      if (!peerPubkey) return;
      addChatMessage({
        id: message.id,
        peerPubkey,
        fromPubkey: message.outgoing ? selfPubkeyRef.current : message.pubkey,
        content: text,
        createdAt: message.created_at * 1000,
        outgoing: Boolean(message.outgoing),
      });
    },
    [addChatMessage, handleSignal]
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

        const localContacts = readStoredContacts(pubkey);
        contactsRef.current = localContacts;
        setContacts(localContacts);
        const storedCalls = readStoredCalls(pubkey);
        callLogsRef.current = new Map(storedCalls.map((log) => [log.callId, log]));
        setCallLogs(storedCalls);
        setSelectedPubkey((current) => current || localContacts[0]?.pubkey || '');

        void loadContactsFromNostr().catch(() => undefined);

        const params = new URLSearchParams(window.location.search);
        const peer = params.get('peer');
        const routeCallId = params.get('callId');
        if (peer) {
          const normalizedPeer = upsertContact(peer, undefined, 'dm');
          setSelectedPubkey(normalizedPeer);
        }
        if (routeCallId) {
          callIdRef.current = routeCallId;
          setCallId(routeCallId);
          setStatus('Looking for pending call invite...');
        }

        const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 14;
        const stop = apna.social.v1.subscribeMessages({ since }, handleDirectMessage);
        unsubscribeMessagesRef.current = stop;

        const inbox = await apna.social.v1.messages({ since, limit: 300 }).catch(() => []);
        if (disposed) return;
        inbox.forEach(handleDirectMessage);
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
      stopScanner();
    };
  }, [apna, handleDirectMessage, resetCall, upsertContact]);

  useEffect(() => {
    contacts.forEach((contact) => {
      void fetchContactProfile(contact.pubkey);
    });
  }, [contacts, fetchContactProfile]);

  useEffect(() => {
    if (!selfNpub) {
      setMyQrDataUrl('');
      return;
    }

    let disposed = false;
    void QRCode.toDataURL(selfNpub, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#00201c',
        light: '#ffffff',
      },
    }).then((dataUrl) => {
      if (!disposed) setMyQrDataUrl(dataUrl);
    });

    return () => {
      disposed = true;
    };
  }, [selfNpub]);

  useEffect(() => {
    if (!selfPubkey || contacts.length === 0) return;
    const timeout = window.setTimeout(() => {
      void syncContactsToNostr(contacts).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timeout);
    // Contacts are intentionally auto-published after local changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, selfPubkey]);

  async function loadContactsFromNostr() {
    try {
      await apna.permissions.request([
        'nostr.query',
        'nostr.publish',
        'nostr.nip04.encrypt',
        'nostr.nip04.decrypt',
      ]);

      const events = await apna.nostr.query({
        kinds: [30078],
        authors: [selfPubkeyRef.current],
        '#d': [SETTINGS_D_TAG],
        limit: 1,
      });
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest?.content) {
        setSyncStatus('Contacts can sync to Nostr');
        return;
      }

      const decrypted = await apna.nostr.nip04.decrypt(selfPubkeyRef.current, latest.content);
      const remoteContacts = parseContactsBackup(decrypted);
      if (remoteContacts.length === 0) {
        setSyncStatus('Contacts can sync to Nostr');
        return;
      }

      const merged = mergeContacts(readStoredContacts(selfPubkeyRef.current), remoteContacts);
      saveContacts(merged);
      setSelectedPubkey((current) => current || merged[0]?.pubkey || '');
      setSyncStatus(`Loaded ${merged.length} contacts from Nostr settings`);
    } catch {
      setSyncStatus('Local contacts only');
    }
  }

  async function syncContactsToNostr(nextContacts = contactsRef.current) {
    setError('');
    try {
      await apna.permissions.request([
        'nostr.publish',
        'nostr.nip04.encrypt',
      ]);
      setSyncStatus('Auto-syncing contacts...');
      const content = JSON.stringify({ version: 1, contacts: nextContacts });
      const encrypted = await apna.nostr.nip04.encrypt(selfPubkeyRef.current, content);
      await apna.nostr.publish({
        kind: 30078,
        content: encrypted,
        tags: [['d', SETTINGS_D_TAG]],
      });
      setSyncStatus(`Synced ${nextContacts.length} contacts to Nostr settings`);
    } catch (err) {
      setSyncStatus('Nostr sync unavailable');
      setError((err as Error).message);
    }
  }

  async function addContactFromDraft(source: Contact['source'] = 'manual') {
    setError('');
    try {
      const normalized = upsertContact(contactDraftKey, contactDraftName, source);
      void fetchContactProfile(normalized);
      setSelectedPubkey(normalized);
      setContactDraftKey('');
      setContactDraftName('');
      setAddingContact(false);
      setScannerOpen(false);
      stopScanner();
      setStatus('Contact saved');
      void syncContactsToNostr(contactsRef.current).catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copyMyNpub() {
    if (!selfNpub) return;
    try {
      await navigator.clipboard.writeText(selfNpub);
      setQrCopyStatus('Copied');
      window.setTimeout(() => setQrCopyStatus(''), 1800);
    } catch {
      setQrCopyStatus('Copy failed');
    }
  }

  async function shareMyNpub() {
    if (!selfNpub) return;
    const shareData = {
      title: 'My Apna IM contact',
      text: selfNpub,
    };

    if (navigator.share) {
      await navigator.share(shareData).catch(() => undefined);
      return;
    }

    await copyMyNpub();
  }

  function removeContact(pubkey: string) {
    const next = contacts.filter((contact) => contact.pubkey !== pubkey);
    saveContacts(next);
    void syncContactsToNostr(next).catch(() => undefined);
    if (selectedPubkey === pubkey) {
      setSelectedPubkey(next[0]?.pubkey || '');
      setChatOpen(false);
    }
  }

  async function sendMessage() {
    const text = composerText.trim();
    if (!text || !selectedPubkey) return;

    setError('');
    setComposerText('');
    const tempId = `local-${Date.now()}`;
    addChatMessage({
      id: tempId,
      peerPubkey: selectedPubkey,
      fromPubkey: selfPubkeyRef.current,
      content: text,
      createdAt: Date.now(),
      outgoing: true,
      pending: true,
    });

    try {
      const sent = await apna.social.v1.sendDirectMessage(selectedPubkey, text);
      messagesRef.current.delete(tempId);
      addChatMessage({
        id: sent.id || tempId,
        peerPubkey: selectedPubkey,
        fromPubkey: selfPubkeyRef.current,
        content: sent.plaintext || text,
        createdAt: (sent.created_at || Math.floor(Date.now() / 1000)) * 1000,
        outgoing: true,
      });
    } catch (err) {
      const failed = messagesRef.current.get(tempId);
      if (failed) {
        messagesRef.current.set(tempId, { ...failed, pending: false });
        setMessages(Array.from(messagesRef.current.values()).sort((a, b) => a.createdAt - b.createdAt));
      }
      setError((err as Error).message);
    }
  }

  function startChatWith(pubkey: string) {
    setSelectedPubkey(pubkey);
    setActiveTab('chats');
    setChatOpen(true);
    setContactPickerOpen(false);
    setAddingContact(false);
  }

  function insertEmoji(emoji: string) {
    setComposerText((current) => `${current}${emoji}`);
    setEmojiOpen(false);
  }

  async function startCall(targetPubkey: string, withVideo: boolean) {
    setError('');
    setWakeStatus('');
    try {
      const target = normalizeRecipient(targetPubkey);
      videoEnabledRef.current = withVideo;
      setVideoEnabled(withVideo);
      const nextCallId = crypto.randomUUID();
      peerPubkeyRef.current = target;
      callIdRef.current = nextCallId;
      setSelectedPubkey(target);
      setCallId(nextCallId);
      setIncomingCall(null);
      setCallState('calling');
      upsertCallLog({
        callId: nextCallId,
        peerPubkey: target,
        direction: 'outgoing',
        media: { audio: true, video: withVideo },
        status: 'missed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setStatus(withVideo ? 'Requesting camera and microphone...' : 'Requesting microphone...');

      const stream = await startLocalMedia();
      const pc = createPeerConnection(target);
      addLocalTracks(pc, stream);

      await sendSignal(target, {
        type: 'invite',
        media: { audio: true, video: withVideo },
      });
      void wakeCounterparty(target, nextCallId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(target, {
        type: 'offer',
        media: { audio: true, video: withVideo },
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
      videoEnabledRef.current = incomingCall.media.video;
      setVideoEnabled(incomingCall.media.video);
      peerPubkeyRef.current = target;
      callIdRef.current = incomingCall.callId;
      setSelectedPubkey(target);
      setCallId(incomingCall.callId);
      setCallState('connecting');
      upsertCallLog({
        callId: incomingCall.callId,
        peerPubkey: target,
        direction: 'incoming',
        media: incomingCall.media,
        status: 'answered',
        createdAt: incomingCall.createdAt,
        updatedAt: Date.now(),
      });
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
      const existing = callLogsRef.current.get(incomingCall.callId);
      if (existing) upsertCallLog({ ...existing, status: 'declined', updatedAt: Date.now() });
    }
    resetCall('Call declined');
  }

  async function hangUp() {
    const target = peerPubkeyRef.current;
    if (target && callIdRef.current) {
      await sendSignal(target, { type: 'hangup' }).catch(() => undefined);
      const existing = callLogsRef.current.get(callIdRef.current);
      if (existing) upsertCallLog({ ...existing, status: 'ended', updatedAt: Date.now() });
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

  async function wakeCounterparty(targetPubkey: string, activeCallId: string) {
    const wakeApiUrl = process.env.NEXT_PUBLIC_WAKE_API_URL || '/api/calls/wake';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const hostOrigin = process.env.NEXT_PUBLIC_HOST_APP_ORIGIN || window.location.origin;
    const callerName = profileName(selfProfile) || shortPubkey(selfPubkeyRef.current);
    const miniAppUrl = `${appUrl}?callId=${encodeURIComponent(
      activeCallId
    )}&peer=${encodeURIComponent(selfPubkeyRef.current)}`;
    const deepLink = `${hostOrigin.replace(
      /\/+$/,
      ''
    )}/app?appId=im-mini-app&appUrl=${encodeURIComponent(
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

  async function startScanner() {
    setError('');
    setScannerStatus('');
    const Detector = getBarcodeDetector();
    if (!Detector) {
      setScannerStatus('QR scanning is not available in this browser. Paste the npub instead.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus('Camera access is not available in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      scannerStreamRef.current = stream;
      if (scannerVideoRef.current) {
        scannerVideoRef.current.srcObject = stream;
        await scannerVideoRef.current.play();
      }

      const detector = new Detector({ formats: ['qr_code'] });
      let active = true;
      const scan = async () => {
        if (!active || !scannerOpen) return;
        const video = scannerVideoRef.current;
        if (video && video.readyState >= 2) {
          const results = await detector.detect(video).catch(() => []);
          const value = results[0]?.rawValue;
          if (value) {
            const extracted = extractNpubOrPubkey(value);
            if (extracted) {
              setContactDraftKey(extracted);
              setScannerStatus('QR detected. Save the contact to keep it.');
              active = false;
              stopScanner();
              return;
            }
          }
        }
        window.setTimeout(scan, 350);
      };
      void scan();
      setScannerStatus('Point the camera at an npub QR code.');
    } catch (err) {
      setScannerStatus((err as Error).message);
    }
  }

  function stopScanner() {
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
    scannerStreamRef.current = null;
    if (scannerVideoRef.current) scannerVideoRef.current.srcObject = null;
  }

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return;
    }
    void startScanner();
    return stopScanner;
    // scannerOpen intentionally controls the camera lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  const inCall =
    callState === 'calling' || callState === 'connecting' || callState === 'connected';
  const selectedTitle = selectedContact
    ? displayNameForContact(selectedContact)
    : shortPubkey(selectedPubkey);

  return (
    <main
      className={`shell chat-shell tab-${activeTab}${
        chatOpen && selectedPubkey ? ' chat-open' : ''
      }`}
    >
      <aside className="sidebar" aria-label="Contacts">
        <header className="sidebar-header">
          <div className="brand-lockup">
            <MessageCircle size={22} />
            <h1>IM Mini App</h1>
          </div>
          <div className="top-menu">
            <button
              type="button"
              className="appbar-button"
              title="More"
              onClick={() => setMenuOpen((current) => !current)}
            >
              <MoreVertical size={20} />
            </button>
            {menuOpen && (
              <div className="menu-popover">
                <div className={error ? 'menu-status menu-status-error' : 'menu-status'}>
                  {error || status}
                </div>
                <button type="button" onClick={() => { setShowMyQr(true); setMenuOpen(false); }}>
                  <QrCode size={18} />
                  <span>My QR code</span>
                </button>
                <button type="button" onClick={() => { setAddingContact(true); setMenuOpen(false); }}>
                  <Plus size={18} />
                  <span>Add contact</span>
                </button>
                <button type="button" onClick={() => { toggleTheme(); setMenuOpen(false); }}>
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                  <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="tab-title-row">
          <div>
            <p className="eyebrow">
              {activeTab === 'calls'
                ? 'Latest first'
                : activeTab === 'contacts'
                  ? 'Nostr settings'
                  : 'Latest DMs'}
            </p>
            <h2>{activeTab === 'calls' ? 'Calls' : activeTab === 'contacts' ? 'Contacts' : 'Chats'}</h2>
          </div>
          <button
            type="button"
            className="fab-inline"
            onClick={() => setAddingContact(true)}
            title="Add contact"
          >
            <Plus size={19} />
          </button>
        </div>

        <div className="identity-row" title={selfPubkey || 'Connecting'}>
          {renderAvatar(profileName(selfProfile) || 'You', selfProfile, 'avatar self-avatar')}
          <div>
            <strong>{profileName(selfProfile) || 'You'}</strong>
            <span>{selfNpub ? `${selfNpub.slice(0, 12)}...${selfNpub.slice(-6)}` : 'Connecting'}</span>
          </div>
          <button type="button" className="identity-qr-button" onClick={() => setShowMyQr(true)}>
            <QrCode size={18} />
          </button>
        </div>

        <div className="search-row">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search contacts"
          />
        </div>

        <div className="contact-list">
          {tabContacts.length === 0 ? (
            <div className="empty-state">
              {activeTab === 'calls' ? <Phone size={28} /> : <MessageCircle size={28} />}
              <strong>{activeTab === 'calls' ? 'No calls yet' : 'No contacts yet'}</strong>
              <span>
                {activeTab === 'calls'
                  ? 'Start a voice or video call from a chat.'
                  : 'Add an npub manually or scan a QR code.'}
              </span>
            </div>
          ) : (
            tabContacts.map((contact) => {
              const contactProfile = profilesByPubkey[contact.pubkey] ?? null;
              const contactName = displayNameForContact(contact);
              return (
              <button
                key={contact.pubkey}
                type="button"
                className={
                  contact.pubkey === selectedPubkey
                    ? 'contact-row contact-row-active'
                    : 'contact-row'
                }
                onClick={() => {
                  setSelectedPubkey(contact.pubkey);
                  setChatOpen(true);
                }}
              >
                {renderAvatar(contactName, contactProfile)}
                <div className="contact-main">
                  <div className="contact-line">
                    <strong>{contactName}</strong>
                    <time>
                      {activeTab === 'calls'
                        ? lastCallTimeLabel(callLogs, contact.pubkey)
                        : lastMessageTimeLabel(messages, contact.pubkey)}
                    </time>
                  </div>
                  <div className="contact-line contact-preview">
                    <span>
                      {activeTab === 'calls'
                        ? lastCallPreview(callLogs, contact.pubkey)
                        : activeTab === 'contacts'
                          ? `${contact.source === 'nostr' ? 'Synced from' : 'Saved to'} kind 30078 · ${contact.npub}`
                          : lastMessagePreview(messages, contact.pubkey) || contact.npub}
                    </span>
                    {activeTab === 'calls' ? <Phone size={16} /> : null}
                  </div>
                </div>
              </button>
              );
            })
          )}
        </div>

        <footer className="sync-bar">
          <span>{syncStatus}</span>
          <span>kind 30078</span>
        </footer>

        <button type="button" className="floating-compose" onClick={() => setContactPickerOpen(true)}>
          <MessageCircle size={25} />
        </button>

        <nav className="bottom-nav" aria-label="IM navigation">
          <button
            type="button"
            className={activeTab === 'chats' ? 'bottom-nav-active' : ''}
            onClick={() => setActiveTab('chats')}
          >
            <MessageCircle size={20} />
            <span>Chats</span>
          </button>
          <button
            type="button"
            className={activeTab === 'calls' ? 'bottom-nav-active' : ''}
            onClick={() => setActiveTab('calls')}
          >
            <Phone size={20} />
            <span>Calls</span>
          </button>
          <button
            type="button"
            className={activeTab === 'contacts' ? 'bottom-nav-active' : ''}
            onClick={() => setActiveTab('contacts')}
          >
            <ContactRound size={20} />
            <span>Contacts</span>
          </button>
        </nav>
      </aside>

      <section className="conversation chat-bg" aria-label="Conversation">
        {selectedPubkey ? (
          <>
            <header className="conversation-header">
              <button
                type="button"
                className="appbar-button back-button"
                onClick={() => setChatOpen(false)}
                title="Back to chats"
              >
                <ArrowLeft size={21} />
              </button>
              <div className="peer-summary">
                {renderAvatar(selectedTitle, selectedProfile)}
                <div>
                  <h2>{selectedTitle}</h2>
                  <span>encrypted · {shortPubkey(selectedPubkey)}</span>
                </div>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="appbar-button"
                  onClick={() => void startCall(selectedPubkey, false)}
                  disabled={callState !== 'ready'}
                  title="Start voice call"
                >
                  <Phone size={19} />
                </button>
                <button
                  type="button"
                  className="appbar-button"
                  onClick={() => void startCall(selectedPubkey, true)}
                  disabled={callState !== 'ready'}
                  title="Start video call"
                >
                  <Video size={19} />
                </button>
                <button
                  type="button"
                  className="appbar-button"
                  onClick={() => removeContact(selectedPubkey)}
                  title="Remove contact"
                >
                  <MoreVertical size={19} />
                </button>
              </div>
            </header>

            <div className="messages-pane">
              <div className="date-chip">TODAY</div>
              {activeMessages.length === 0 ? (
                <div className="thread-empty">
                  <MessageCircle size={34} />
                  <strong>Start a private Nostr DM</strong>
                  <span>Messages use the host social DM capability.</span>
                </div>
              ) : (
                activeMessages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.outgoing
                        ? 'message-row message-row-out'
                        : 'message-row message-row-in'
                    }
                  >
                    <div className={message.outgoing ? 'bubble bubble-out' : 'bubble bubble-in'}>
                      <p>{message.content}</p>
                      <span>
                        {formatMessageTime(message.createdAt)}
                        {message.pending ? ' · sending' : message.outgoing ? ' · read' : ''}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div className="encryption-chip">
                <ShieldCheck size={14} />
                <span>Messages are encrypted through Nostr DMs.</span>
              </div>
            </div>

            <footer className="composer">
              <div className="composer-field">
                <button type="button" title="Emoji" onClick={() => setEmojiOpen((current) => !current)}>
                  <Smile size={20} />
                </button>
                {emojiOpen && (
                  <div className="emoji-tray">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              <textarea
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Message"
                rows={1}
              />
                <button type="button" title="Attach">
                  <Paperclip size={20} />
                </button>
                <button type="button" title="Camera">
                  <Camera size={20} />
                </button>
              </div>
              <button
                type="button"
                className="send-button"
                onClick={() => void sendMessage()}
                disabled={!composerText.trim()}
                title="Send message"
              >
                <Send size={18} />
              </button>
            </footer>
          </>
        ) : (
          <div className="select-empty">
            <MessageCircle size={42} />
            <h2>Select a chat</h2>
            <p>Add a contact by npub or QR code to start messaging and calling.</p>
            <button type="button" className="primary-button" onClick={() => setAddingContact(true)}>
              <Plus size={18} />
              <span>Add contact</span>
            </button>
          </div>
        )}
      </section>

      {(inCall || callState === 'ringing') && (
        <section className="call-panel" aria-label="Active call">
          <div className="call-stage">
            <div className={hasRemoteMedia ? 'remote-pane has-remote-media' : 'remote-pane'}>
              <video ref={remoteVideoRef} autoPlay playsInline className="video" />
              <div className="remote-placeholder">
                <PhoneCall size={30} />
                <span>{remoteLabel(callState, peerPubkeyRef.current || selectedPubkey, incomingCall)}</span>
              </div>
            </div>
            <div className="local-preview">
              <video ref={localVideoRef} autoPlay playsInline muted className="video" />
              <span>{cameraMuted ? 'Camera off' : 'You'}</span>
            </div>
          </div>
          <div className="call-footer">
            <div>
              <strong>{callState}</strong>
              <span>{callId ? `${callId.slice(0, 8)} · ${wakeStatus || status}` : wakeStatus || status}</span>
            </div>
            {callState === 'ringing' && incomingCall ? (
              <div className="call-actions">
                <button type="button" className="danger-button" onClick={rejectCall}>
                  <PhoneOff size={18} />
                  <span>Decline</span>
                </button>
                <button type="button" className="primary-button" onClick={acceptCall}>
                  <PhoneCall size={18} />
                  <span>Accept</span>
                </button>
              </div>
            ) : (
              <div className="call-actions">
                <button type="button" className="icon-button" onClick={toggleMic} disabled={!inCall}>
                  {micMuted ? <MicOff size={19} /> : <Mic size={19} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={toggleCamera}
                  disabled={!inCall || !videoEnabled}
                >
                  {cameraMuted ? <VideoOff size={19} /> : <Video size={19} />}
                </button>
                <button type="button" className="danger-button" onClick={hangUp} disabled={!inCall}>
                  <PhoneOff size={18} />
                  <span>Hang up</span>
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {showMyQr && (
        <section className="my-qr-screen" role="dialog" aria-modal="true">
          <header className="qr-appbar">
            <div className="brand-lockup">
              <button
                type="button"
                className="appbar-button"
                onClick={() => setShowMyQr(false)}
                title="Back"
              >
                <ArrowLeft size={21} />
              </button>
              <h1>My QR Code</h1>
            </div>
            <button type="button" className="appbar-button" title="More">
              <MoreVertical size={20} />
            </button>
          </header>

          <main className="my-qr-body">
            <section className="my-qr-card">
              <div className="my-qr-profile">
                {renderAvatar(profileName(selfProfile) || 'You', selfProfile, 'avatar qr-profile-avatar')}
                <h2>{profileName(selfProfile) || 'You'}</h2>
                <button type="button" className="npub-copy-row" onClick={() => void copyMyNpub()}>
                  <span>{selfNpub ? `${selfNpub.slice(0, 12)}...${selfNpub.slice(-8)}` : 'Loading npub'}</span>
                  <Copy size={14} />
                </button>
              </div>

              <div className="qr-frame">
                {myQrDataUrl ? (
                  <img src={myQrDataUrl} alt="My Nostr npub QR code" />
                ) : (
                  <div className="qr-loading">Generating QR</div>
                )}
              </div>

              <p>Scan this code to add me as an IM Mini App contact.</p>
              {qrCopyStatus && <span className="qr-copy-status">{qrCopyStatus}</span>}
            </section>
          </main>

          <footer className="my-qr-actions">
            <button type="button" className="primary-button" onClick={() => void shareMyNpub()}>
              <Share2 size={18} />
              <span>Share Code</span>
            </button>
            <button type="button" className="secondary-button" onClick={() => void copyMyNpub()}>
              <Copy size={18} />
              <span>Copy npub</span>
            </button>
          </footer>
        </section>
      )}

      {addingContact && (
        <section className="modal-backdrop" role="dialog" aria-modal="true">
          <div className={scannerOpen ? 'contact-modal scanner-modal' : 'contact-modal'}>
            <header>
              <div>
                <p className="eyebrow">New contact</p>
                <h2>Add by npub</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setAddingContact(false);
                  setScannerOpen(false);
                  stopScanner();
                }}
                title="Close"
              >
                <X size={18} />
              </button>
            </header>

            <label>
              Name
              <input
                value={contactDraftName}
                onChange={(event) => setContactDraftName(event.target.value)}
                placeholder="Satoshi"
              />
            </label>
            <label>
              npub or pubkey
              <textarea
                value={contactDraftKey}
                onChange={(event) => setContactDraftKey(event.target.value)}
                placeholder="npub1..."
                rows={3}
              />
            </label>

            <div className="scanner-tools">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setScannerOpen((current) => !current)}
              >
                <QrCode size={18} />
                <span>{scannerOpen ? 'Stop scan' : 'Scan QR'}</span>
              </button>
              <button type="button" className="secondary-button" onClick={() => setShowMyQr(true)}>
                <QrCode size={18} />
                <span>My QR</span>
              </button>
              <button type="button" className="secondary-button" onClick={() => setContactDraftKey('')}>
                <Keyboard size={18} />
                <span>Clear</span>
              </button>
            </div>

            {scannerOpen && (
              <div className="scanner-box">
                <video ref={scannerVideoRef} muted playsInline />
                <span>{scannerStatus || 'Starting camera...'}</span>
              </div>
            )}

            <footer>
              <button type="button" className="secondary-button" onClick={() => setAddingContact(false)}>
                <X size={18} />
                <span>Cancel</span>
              </button>
              <button type="button" className="primary-button" onClick={() => void addContactFromDraft(scannerOpen ? 'qr' : 'manual')}>
                <Check size={18} />
                <span>Save</span>
              </button>
            </footer>
          </div>
        </section>
      )}

      {contactPickerOpen && (
        <section className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="contact-modal contact-picker">
            <header>
              <div>
                <p className="eyebrow">Start chat</p>
                <h2>Saved contacts</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setContactPickerOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </header>
            <div className="picker-list">
              {contacts.length === 0 ? (
                <div className="thread-empty">
                  <ContactRound size={28} />
                  <strong>No saved contacts</strong>
                  <span>Add a contact first to start a DM.</span>
                </div>
              ) : (
                contacts.map((contact) => {
                  const contactProfile = profilesByPubkey[contact.pubkey] ?? null;
                  const contactName = displayNameForContact(contact);
                  return (
                    <button
                      key={contact.pubkey}
                      type="button"
                      className="picker-contact"
                      onClick={() => startChatWith(contact.pubkey)}
                    >
                      {renderAvatar(contactName, contactProfile)}
                      <span>{contactName}</span>
                    </button>
                  );
                })
              )}
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setAddingContact(true)}>
                <Plus size={18} />
                <span>Add contact</span>
              </button>
            </footer>
          </div>
        </section>
      )}

      {error && (
        <button
          type="button"
          className="reload-fab"
          onClick={() => window.location.reload()}
          title="Reload"
        >
          <RefreshCw size={18} />
        </button>
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
  const extracted = extractNpubOrPubkey(value);
  if (!extracted) throw new Error('Contact must be an npub or 64-character hex pubkey.');
  const trimmed = extracted.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  const decoded = nip19.decode(trimmed);
  if (decoded.type === 'npub' && typeof decoded.data === 'string') {
    return decoded.data.toLowerCase();
  }
  throw new Error('Contact must be an npub or 64-character hex pubkey.');
}

function extractNpubOrPubkey(value: string): string | null {
  const trimmed = value.trim();
  const npub = trimmed.match(/npub1[023456789acdefghjklmnpqrstuvwxyz]+/i)?.[0];
  if (npub) return npub;
  const hex = trimmed.match(/\b[0-9a-f]{64}\b/i)?.[0];
  return hex ?? null;
}

function inferMessagePeer(message: DirectMessage, selfPubkey: string): string | null {
  if (message.peerPubkey) return normalizeRecipient(message.peerPubkey);
  if (!message.outgoing) return normalizeRecipient(message.pubkey);
  const taggedPeer = message.tags?.find((tag) => tag[0] === 'p' && tag[1] !== selfPubkey)?.[1];
  return taggedPeer ? normalizeRecipient(taggedPeer) : null;
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

function profilePicture(profile: UserProfile | null): string {
  const metadata = profile?.metadata;
  const picture = metadata?.picture;
  if (typeof picture === 'string') return picture;
  const image = metadata?.image;
  return typeof image === 'string' ? image : '';
}

function profileSearchText(profile: UserProfile | null): string {
  const metadata = profile?.metadata;
  if (!metadata) return '';
  return [
    metadata.name,
    metadata.display_name,
    metadata.username,
    metadata.nip05,
    metadata.about,
    metadata.lud16,
    metadata.website,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function contactsStorageKey(pubkey: string): string {
  return `${CONTACTS_STORAGE_PREFIX}.${pubkey}`;
}

function callsStorageKey(pubkey: string): string {
  return `${CALLS_STORAGE_PREFIX}.${pubkey}`;
}

function readStoredContacts(pubkey: string): Contact[] {
  try {
    const raw = window.localStorage.getItem(contactsStorageKey(pubkey));
    if (!raw) return [];
    return parseContactsBackup(JSON.stringify({ version: 1, contacts: JSON.parse(raw) }));
  } catch {
    return [];
  }
}

function readStoredCalls(pubkey: string): CallLog[] {
  try {
    const raw = window.localStorage.getItem(callsStorageKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Partial<CallLog>;
      if (typeof record.callId !== 'string' || typeof record.peerPubkey !== 'string') return [];
      const peerPubkey = normalizeRecipient(record.peerPubkey);
      const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
      const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
      const direction: CallLog['direction'] =
        record.direction === 'incoming' ? 'incoming' : 'outgoing';
      return [
        {
          callId: record.callId,
          peerPubkey,
          direction,
          media: record.media ?? { audio: true, video: true },
          status:
            record.status === 'answered' ||
            record.status === 'declined' ||
            record.status === 'ended' ||
            record.status === 'missed'
              ? record.status
              : 'ended',
          createdAt,
          updatedAt,
        },
      ];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function parseContactsBackup(value: string): Contact[] {
  try {
    const parsed = JSON.parse(value) as { contacts?: unknown };
    if (!Array.isArray(parsed.contacts)) return [];
    return parsed.contacts.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Partial<Contact>;
      if (typeof record.pubkey !== 'string') return [];
      const pubkey = normalizeRecipient(record.pubkey);
      return [
        {
          pubkey,
          npub: nip19.npubEncode(pubkey),
          label: typeof record.label === 'string' && record.label.trim()
            ? record.label.trim()
            : shortPubkey(pubkey),
          addedAt: typeof record.addedAt === 'number' ? record.addedAt : Date.now(),
          source: record.source === 'manual' || record.source === 'qr' || record.source === 'nostr'
            ? record.source
            : 'dm',
        },
      ];
    });
  } catch {
    return [];
  }
}

function mergeContacts(local: Contact[], remote: Contact[]): Contact[] {
  const byPubkey = new Map<string, Contact>();
  [...remote, ...local].forEach((contact) => {
    byPubkey.set(contact.pubkey, {
      ...contact,
      source: contact.source === 'dm' ? 'nostr' : contact.source,
    });
  });
  return Array.from(byPubkey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function sortContacts(contacts: Contact[], messageMap: Map<string, ChatMessage>): Contact[] {
  return [...contacts].sort((a, b) => {
    const aTime = latestMessageTime(messageMap, a.pubkey) || a.addedAt;
    const bTime = latestMessageTime(messageMap, b.pubkey) || b.addedAt;
    return bTime - aTime;
  });
}

function latestMessageTime(messageMap: Map<string, ChatMessage>, pubkey: string): number {
  let latest = 0;
  messageMap.forEach((message) => {
    if (message.peerPubkey === pubkey) latest = Math.max(latest, message.createdAt);
  });
  return latest;
}

function lastMessagePreview(messages: ChatMessage[], pubkey: string): string {
  const latest = messages
    .filter((message) => message.peerPubkey === pubkey)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return latest?.content || '';
}

function lastMessageTimeLabel(messages: ChatMessage[], pubkey: string): string {
  const latest = messages
    .filter((message) => message.peerPubkey === pubkey)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!latest) return '';

  const date = new Date(latest.createdAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatMessageTime(latest.createdAt);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function latestCalls(callLogs: CallLog[]): CallLog[] {
  const byPeer = new Map<string, CallLog>();
  callLogs.forEach((call) => {
    const existing = byPeer.get(call.peerPubkey);
    if (!existing || call.updatedAt > existing.updatedAt) byPeer.set(call.peerPubkey, call);
  });
  return Array.from(byPeer.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function latestCallForPeer(callLogs: CallLog[], pubkey: string): CallLog | null {
  return callLogs
    .filter((call) => call.peerPubkey === pubkey)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function lastCallPreview(callLogs: CallLog[], pubkey: string): string {
  const latest = latestCallForPeer(callLogs, pubkey);
  if (!latest) return 'No calls yet';
  const direction = latest.direction === 'incoming' ? 'Incoming' : 'Outgoing';
  const media = latest.media.video ? 'video' : 'voice';
  return `${direction} ${media} call · ${latest.status}`;
}

function lastCallTimeLabel(callLogs: CallLog[], pubkey: string): string {
  const latest = latestCallForPeer(callLogs, pubkey);
  return latest ? formatRelativeTime(latest.updatedAt) : '';
}

function formatRelativeTime(time: number): string {
  const date = new Date(time);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatMessageTime(time);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}

function formatMessageTime(time: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
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

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const candidate = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return candidate ?? null;
}
