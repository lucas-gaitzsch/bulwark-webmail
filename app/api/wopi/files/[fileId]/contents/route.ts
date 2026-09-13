import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { downloadFileBlob, getWopiFileNode, updateFileNodeBlob, uploadFileBlob } from '@/lib/wopi/files';
import { wopiContext } from '@/lib/wopi/request';

/**
 * WOPI GetFile / PutFile (#425). Content flows purely over JMAP: GetFile
 * streams the node's blob, PutFile uploads the editor's bytes as a new blob
 * and points the FileNode at it via `FileNode/set { blobId }`.
 */

/** GET = GetFile */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const auth = await wopiContext(request, fileId);
    if (!auth) {
      return NextResponse.json({ error: 'Invalid access token' }, { status: 401 });
    }

    const node = await getWopiFileNode(auth.ctx, auth.payload.accountId, fileId);
    if (!node || !node.blobId) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const upstream = await downloadFileBlob(
      auth.ctx, auth.payload.accountId, node.blobId, node.name, node.type,
    );
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Blob download failed' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', node.type || 'application/octet-stream');
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) headers.set('Content-Length', contentLength);
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    logger.error('WOPI GetFile failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST = PutFile (X-WOPI-Override: PUT) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const auth = await wopiContext(request, fileId);
    if (!auth) {
      return NextResponse.json({ error: 'Invalid access token' }, { status: 401 });
    }
    if (!auth.payload.canWrite) {
      return NextResponse.json({ error: 'Read-only token' }, { status: 403 });
    }

    const node = await getWopiFileNode(auth.ctx, auth.payload.accountId, fileId);
    if (!node || !node.blobId) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Collabora sends the LastModifiedTime it saw at load/last save. A
    // mismatch means someone else changed the document meanwhile - answer
    // 409 + COOLStatusCode 1010 so the editor prompts the user instead of
    // silently overwriting.
    const clientStamp =
      request.headers.get('X-COOL-WOPI-Timestamp') || request.headers.get('X-LOOL-WOPI-Timestamp');
    if (clientStamp && node.modified) {
      const ours = Date.parse(node.modified);
      const theirs = Date.parse(clientStamp);
      if (Number.isFinite(ours) && Number.isFinite(theirs) && ours !== theirs) {
        return NextResponse.json({ COOLStatusCode: 1010 }, { status: 409 });
      }
    }

    const body = await request.arrayBuffer();
    if (body.byteLength === 0) {
      return NextResponse.json({ error: 'Empty document rejected' }, { status: 409 });
    }

    const blob = await uploadFileBlob(auth.ctx, auth.payload.accountId, body, node.type);
    const { modified } = await updateFileNodeBlob(
      auth.ctx, auth.payload.accountId, fileId, blob.blobId,
    );

    return NextResponse.json({ LastModifiedTime: modified });
  } catch (error) {
    logger.error('WOPI PutFile failed', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
