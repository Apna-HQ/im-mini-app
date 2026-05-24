# Signaling

Signals are JSON strings sent through `social.v1.sendDirectMessage`. They are NIP-04 encrypted by the Apna host capability for the active user.

```ts
type CallSignalType =
  | 'invite'
  | 'accept'
  | 'reject'
  | 'hangup'
  | 'offer'
  | 'answer'
  | 'ice';

interface CallSignal {
  kind: 'im.call.signal';
  version: 1;
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
```

The `callId` links foreground encrypted DM signaling with the Apna host push deep link.
