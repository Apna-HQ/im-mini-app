import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { finalizeEvent } from 'nostr-tools';
import * as nip19 from 'nostr-tools/nip19';

export const runtime = 'nodejs';

interface WakeRequestBody {
  targetPubkey?: unknown;
  callId?: unknown;
  callerPubkey?: unknown;
  callerName?: unknown;
  url?: unknown;
  media?: unknown;
}

export async function OPTIONS(): Promise<NextResponse> {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as WakeRequestBody;
    const targetPubkey = normalizePubkey(String(body.targetPubkey || ''));
    const callerPubkey = normalizePubkey(String(body.callerPubkey || ''));
    const callId = String(body.callId || '').trim();
    const callerName = String(body.callerName || '').trim();
    const url = String(body.url || '').trim();
    const media =
      body.media && typeof body.media === 'object'
        ? body.media
        : { audio: true, video: true };

    if (!targetPubkey) {
      return jsonError('targetPubkey must be an npub or hex pubkey', 400);
    }
    if (!callerPubkey) {
      return jsonError('callerPubkey must be an npub or hex pubkey', 400);
    }
    if (!callId) {
      return jsonError('callId is required', 400);
    }
    if (!url) {
      return jsonError('url is required', 400);
    }

    const publisherNsec = process.env.APNA_PUBLISHER_NSEC;
    if (!publisherNsec) {
      return jsonError('APNA_PUBLISHER_NSEC is not configured', 500);
    }

    const apnaHostApiBase = (
      process.env.APNA_HOST_API_BASE || 'http://localhost:3100/api/apna'
    ).replace(/\/+$/, '');

    const endpoint = `${apnaHostApiBase}/notifications/send`;
    const auth = await buildNip98Header(publisherNsec, endpoint, 'POST');
    const label = callerName || shortPubkey(callerPubkey);

    const hostResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Incoming Apna call',
        body: `${label} is calling`,
        url,
        targetPubkey,
        data: {
          type: 'IM_INCOMING_CALL',
          callId,
          callerPubkey,
          targetPubkey,
          url,
          media,
        },
      }),
    });

    const text = await hostResponse.text();
    if (!hostResponse.ok) {
      return jsonError(
        `Apna host returned HTTP ${hostResponse.status}: ${text}`,
        hostResponse.status
      );
    }

    return cors(
      NextResponse.json({
        ok: true,
        host: parseJson(text),
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error), 500);
  }
}

async function buildNip98Header(
  publisherNsec: string,
  url: string,
  method: string
): Promise<string> {
  const decoded = nip19.decode(publisherNsec);
  if (decoded.type !== 'nsec') {
    throw new Error('APNA_PUBLISHER_NSEC must be an nsec');
  }

  const signed = finalizeEvent(
    {
      kind: 27235,
      content: '',
      tags: [
        ['u', url],
        ['method', method.toUpperCase()],
      ],
      created_at: Math.floor(Date.now() / 1000),
    },
    decoded.data
  );

  return `Nostr ${Buffer.from(JSON.stringify(signed)).toString('base64')}`;
}

function normalizePubkey(value: string): string | null {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

  if (trimmed.startsWith('npub')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub' && typeof decoded.data === 'string') {
        return decoded.data.toLowerCase();
      }
    } catch {
      return null;
    }
  }

  return null;
}

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function jsonError(message: string, status: number): NextResponse {
  return cors(NextResponse.json({ error: message }, { status }));
}

function cors(response: NextResponse): NextResponse {
  response.headers.set('access-control-allow-origin', '*');
  response.headers.set('access-control-allow-methods', 'POST, OPTIONS');
  response.headers.set('access-control-allow-headers', 'content-type');
  return response;
}
