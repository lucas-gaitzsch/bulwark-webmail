import { describe, it, expect, vi } from 'vitest';
import { parseWopiDiscovery, buildWopiActionUrl } from '@/lib/wopi/discovery';
import { mintWopiToken, verifyWopiToken } from '@/lib/wopi/token';

// token.ts encrypts via lib/auth/crypto, whose key comes solely from
// getSessionSecret() - mock that seam like auth-crypto.test.ts does.
vi.mock('@/lib/auth/session-secret', () => ({
  getSessionSecret: () => 'x'.repeat(32),
  hasSessionSecret: () => true,
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

const DISCOVERY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wopi-discovery>
  <net-zone name="external-http">
    <app name="writer">
      <action default="true" ext="odt" name="edit" urlsrc="http://office.example:9980/browser/abc123/cool.html?"/>
      <action ext="docx" name="edit" urlsrc="http://office.example:9980/browser/abc123/cool.html?"/>
      <action ext="doc" name="view" urlsrc="http://office.example:9980/browser/abc123/cool.html?"/>
    </app>
    <app name="calc">
      <action default="true" ext="ods" name="edit" urlsrc="http://office.example:9980/browser/abc123/cool.html?"/>
      <action ext="xlsx" name="edit" urlsrc="http://office.example:9980/browser/abc123/cool.html?"/>
    </app>
    <app name="application/vnd.openxmlformats-officedocument.wordprocessingml.document">
      <action default="true" ext="" name="edit" urlsrc="http://office.example:9980/browser/abc123/cool.html?"/>
    </app>
  </net-zone>
</wopi-discovery>`;

describe('parseWopiDiscovery', () => {
  it('maps extensions to edit/view urlsrc', () => {
    const actions = parseWopiDiscovery(DISCOVERY_XML);
    expect(Object.keys(actions.edit).sort()).toEqual(['docx', 'ods', 'odt', 'xlsx']);
    expect(actions.view).toHaveProperty('doc');
    expect(actions.edit.docx).toContain('/cool.html');
  });

  it('ignores actions without an extension and tolerates junk', () => {
    expect(parseWopiDiscovery('<notxml>')).toEqual({ edit: {}, view: {} });
    expect(parseWopiDiscovery('')).toEqual({ edit: {}, view: {} });
  });
});

describe('buildWopiActionUrl', () => {
  it('appends WOPISrc to a urlsrc ending in ?', () => {
    const url = buildWopiActionUrl(
      'http://office.example/browser/abc/cool.html?',
      'http://mail.example/api/wopi/files/f1',
    );
    expect(url).toBe(
      'http://office.example/browser/abc/cool.html?WOPISrc=http%3A%2F%2Fmail.example%2Fapi%2Fwopi%2Ffiles%2Ff1',
    );
  });

  it('drops optional <placeholder&> groups and joins with &', () => {
    const url = buildWopiActionUrl(
      'http://office.example/cool.html?lang=en<ui=UI_LLCC&><rs=DC_LLCC&>',
      'http://mail.example/api/wopi/files/f1',
    );
    expect(url).toBe(
      'http://office.example/cool.html?lang=en&WOPISrc=http%3A%2F%2Fmail.example%2Fapi%2Fwopi%2Ffiles%2Ff1',
    );
  });

  it('starts the query string when urlsrc has none', () => {
    const url = buildWopiActionUrl('http://office.example/edit', 'http://h/api/wopi/files/f1');
    expect(url).toContain('/edit?WOPISrc=');
  });
});

describe('mintWopiToken / verifyWopiToken', () => {
  const payload = {
    serverUrl: 'https://mail.example.com',
    authHeader: 'Basic dXNlcjpwYXNz',
    username: 'user@example.com',
    accountId: 'c',
    fileId: 'f42',
    canWrite: true,
    origin: 'https://webmail.example.com',
  };

  it('round-trips and binds to the fileId', () => {
    const { token, expiresAt } = mintWopiToken(payload);
    expect(expiresAt).toBeGreaterThan(Date.now());
    const verified = verifyWopiToken(token, 'f42');
    expect(verified).toMatchObject(payload);
    // A token for one file must not authorize another.
    expect(verifyWopiToken(token, 'other-file')).toBeNull();
  });

  it('rejects garbage, empty and expired tokens', () => {
    expect(verifyWopiToken(null, 'f42')).toBeNull();
    expect(verifyWopiToken('not-a-token', 'f42')).toBeNull();
    const { token } = mintWopiToken(payload);
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 7 * 60 * 60 * 1000);
    try {
      expect(verifyWopiToken(token, 'f42')).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
