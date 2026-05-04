import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

function createClient(): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/api',
    accountId: 'account-1',
    username: 'user@example.com',
  });
  return client;
}

interface JMAPMethodCall {
  0: string;
  1: Record<string, unknown>;
  2: string;
}

interface CapturedRequest {
  using?: string[];
  methodCalls: JMAPMethodCall[];
}

/**
 * Mock fetch to script three sequential JMAP requests sendEmail makes:
 * Mailbox/get → Identity/get → Email/set + EmailSubmission/set.
 * Returns the captured request bodies for assertions.
 */
function mockSendEmailFlow() {
  const captured: CapturedRequest[] = [];
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  fetchSpy.mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body) as CapturedRequest;
    captured.push(body);
    const callIdx = captured.length - 1;

    let payload: unknown;
    if (callIdx === 0) {
      payload = {
        methodResponses: [[
          'Mailbox/get',
          {
            list: [
              { id: 'mb-drafts', name: 'Drafts', role: 'drafts' },
              { id: 'mb-sent', name: 'Sent', role: 'sent' },
            ],
          },
          '0',
        ]],
      };
    } else if (callIdx === 1) {
      payload = {
        methodResponses: [[
          'Identity/get',
          { list: [{ id: 'identity-1', email: 'user@example.com', mayDelete: false }] },
          '0',
        ]],
      };
    } else {
      payload = {
        methodResponses: [
          ['Email/set', { created: { [Object.keys((captured[callIdx].methodCalls[0][1] as { create: Record<string, unknown> }).create)[0]]: { id: 'sent-id-1' } } }, '0'],
          ['EmailSubmission/set', { created: { '1': { id: 'sub-1' } } }, '1'],
        ],
      };
    }

    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
      json: () => Promise.resolve(payload),
    } as Response;
  });

  return captured;
}

describe('JMAPClient.sendEmail threading headers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes inReplyTo and references on the Email/set create when supplied', async () => {
    const client = createClient();
    const captured = mockSendEmailFlow();

    await client.sendEmail(
      ['recipient@example.com'],
      'Re: testmail',
      'reply body',
      undefined, undefined, 'identity-1', 'user@example.com',
      undefined, undefined, undefined, undefined,
      ['<parent@example.com>'],
      ['<root@example.com>', '<parent@example.com>'],
    );

    // Third request is the Email/set + EmailSubmission/set batch.
    const setCall = captured[2].methodCalls[0];
    expect(setCall[0]).toBe('Email/set');
    const create = setCall[1].create as Record<string, Record<string, unknown>>;
    const draft = Object.values(create)[0];

    // Bare msg-ids per RFC 8621 — angle brackets stripped.
    expect(draft.inReplyTo).toEqual(['parent@example.com']);
    expect(draft.references).toEqual(['root@example.com', 'parent@example.com']);
  });

  it('omits threading fields when no parent ids are supplied', async () => {
    const client = createClient();
    const captured = mockSendEmailFlow();

    await client.sendEmail(
      ['recipient@example.com'],
      'Fresh thread',
      'body',
      undefined, undefined, 'identity-1', 'user@example.com',
    );

    const setCall = captured[2].methodCalls[0];
    const create = setCall[1].create as Record<string, Record<string, unknown>>;
    const draft = Object.values(create)[0];

    expect(draft.inReplyTo).toBeUndefined();
    expect(draft.references).toBeUndefined();
  });

  it('drops empty / whitespace-only ids rather than sending blank entries', async () => {
    const client = createClient();
    const captured = mockSendEmailFlow();

    await client.sendEmail(
      ['recipient@example.com'],
      'Re: testmail',
      'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      undefined, undefined, undefined, undefined,
      ['<>', '   ', '<real@example.com>'],
      [],
    );

    const setCall = captured[2].methodCalls[0];
    const create = setCall[1].create as Record<string, Record<string, unknown>>;
    const draft = Object.values(create)[0];

    expect(draft.inReplyTo).toEqual(['real@example.com']);
    expect(draft.references).toBeUndefined();
  });
});
