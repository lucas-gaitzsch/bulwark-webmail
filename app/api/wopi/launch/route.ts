import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { fetchJmapSession } from '@/lib/stalwart/jmap-api';
import { getWopiActions, buildWopiActionUrl } from '@/lib/wopi/discovery';
import { getWopiFileNode } from '@/lib/wopi/files';
import { mintWopiToken } from '@/lib/wopi/token';

/**
 * POST /api/wopi/launch  { fileId: string, accountId?: string }
 *
 * Mints a WOPI access token scoped to one file node and returns the editor
 * URL to POST it to (#425). Session-authenticated - this is the only WOPI
 * route the browser calls; everything under /api/wopi/files is called by the
 * editor server-to-server with the token minted here.
 */
export async function POST(request: NextRequest) {
  try {
    const creds = await getStalwartCredentials(request);
    if (!creds) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { fileId?: unknown; accountId?: unknown } | null;
    const fileId = typeof body?.fileId === 'string' ? body.fileId : '';
    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
    }

    const actions = await getWopiActions();
    if (!actions) {
      return NextResponse.json({ error: 'No document editor is configured' }, { status: 503 });
    }

    // The dev mock stores a relative serverUrl (/api/dev-jmap); resolve it
    // against this request's origin so server-side calls can reach it. A
    // same-origin server (the mock) is this process itself - the public-URL
    // guard would refuse localhost, so it counts as trusted.
    const serverUrl = new URL(creds.serverUrl, request.nextUrl.origin).toString().replace(/\/+$/, '');
    const trusted = creds.trusted || new URL(serverUrl).origin === request.nextUrl.origin;
    const ctx = { serverUrl, authHeader: creds.authHeader, trusted };

    let accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    if (!accountId) {
      const session = await fetchJmapSession(serverUrl, creds.authHeader, { trusted });
      accountId =
        session?.primaryAccounts?.['urn:ietf:params:jmap:filenode'] ||
        Object.keys(session?.accounts ?? {})[0] ||
        '';
    }
    if (!accountId) {
      return NextResponse.json({ error: 'No files account' }, { status: 404 });
    }

    const node = await getWopiFileNode(ctx, accountId, fileId);
    if (!node || !node.blobId) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const canWrite = node.myRights ? !!node.myRights.mayModifyContent : true;
    const urlsrc = (canWrite && actions.edit[ext]) || actions.view[ext] || actions.edit[ext];
    if (!urlsrc) {
      return NextResponse.json({ error: 'File type not supported by the editor' }, { status: 415 });
    }
    const editable = canWrite && !!actions.edit[ext];

    // Where the editor reaches this webmail. Deployments where the editor
    // sees a different host than the browser (docker networks, split DNS)
    // override it via wopiHostUrl.
    const hostBase =
      configManager.get<string>('wopiHostUrl', '').trim().replace(/\/+$/, '') ||
      request.nextUrl.origin;
    const wopiSrc = `${hostBase}/api/wopi/files/${encodeURIComponent(fileId)}`;

    const { token, expiresAt } = mintWopiToken({
      serverUrl,
      authHeader: creds.authHeader,
      username: creds.username,
      accountId,
      fileId,
      canWrite: editable,
      origin: request.nextUrl.origin,
    });

    return NextResponse.json({
      url: buildWopiActionUrl(urlsrc, wopiSrc),
      accessToken: token,
      accessTokenTtl: expiresAt,
      readOnly: !editable,
    });
  } catch (error) {
    logger.error('WOPI launch failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
