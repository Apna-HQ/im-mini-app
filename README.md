# im-mini-app

Apna mini-app for encrypted direct-message signaling and WebRTC voice/video calls. Built as a Next.js app so it can deploy directly to Vercel.

The host handles identity, permission prompts, encrypted message capabilities, and background wake-up push notifications. The mini-app keeps `MediaStream` local to the browser iframe and sends only WebRTC signaling metadata through Apna social DMs.

## Quick Start

```bash
npm install
npm run dev
```

Open Apna at `http://localhost:3100/app`, then launch this mini-app URL:

```text
http://localhost:5173
```

The Apna host iframe must allow microphone and camera:

```tsx
allow="camera; microphone; autoplay; fullscreen"
```

## Wake Push

Foreground calls work with only the mini-app, because both peers subscribe to encrypted DM signaling. To ring a recipient who is not actively using the mini-app, configure the built-in Next.js API route:

```bash
cp .env.example .env
npm run dev
```

The wake route lives at:

```text
/api/calls/wake
```

Required env:

```text
NEXT_PUBLIC_WAKE_API_URL=/api/calls/wake
NEXT_PUBLIC_HOST_APP_ORIGIN=http://localhost:3100
NEXT_PUBLIC_APP_URL=http://localhost:5173
APNA_HOST_API_BASE=http://localhost:3100/api/apna
APNA_PUBLISHER_NSEC=nsec1...
```

The publisher key must own a published mini-app metadata event in the Apna host, because the host notification endpoint verifies NIP-98 ownership before dispatching push notifications.

## Vercel

Deploy the repository as a normal Next.js project. Set the same env vars in Vercel, with production URLs:

```text
NEXT_PUBLIC_WAKE_API_URL=/api/calls/wake
NEXT_PUBLIC_HOST_APP_ORIGIN=https://your-apna-host.example
NEXT_PUBLIC_APP_URL=https://your-im-mini-app.vercel.app
APNA_HOST_API_BASE=https://your-apna-host.example/api/apna
APNA_PUBLISHER_NSEC=nsec1...
```

## Recipient Format

Dialing and wake push accept both:

- `npub1...`
- 64-character hex pubkey

The app normalizes either form to hex before sending encrypted call signals.

## Call Flow

1. Caller dials a recipient `npub` or hex pubkey.
2. Mini-app requests mic/camera with `getUserMedia`.
3. Mini-app sends encrypted `invite` and `offer` signals with `social.v1.sendDirectMessage`.
4. `/api/calls/wake` asks the Apna host to push a targeted notification to `targetPubkey`.
5. Recipient taps the notification; Apna opens `im-mini-app` with `callId`.
6. Recipient accepts; mini-app sends `accept` and `answer`.
7. WebRTC exchanges ICE candidates over encrypted DMs and carries media peer-to-peer.

## Limits

Browsers do not allow push notifications to silently open camera/microphone or auto-answer. A user gesture is required before the recipient starts media.
