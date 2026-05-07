// Projection helpers - convert host-internal types into the read-only views
// that plugins consume. Keeping this in one place ensures every slot/hook
// hands plugins the same shape declared in plugin-types.ts.

import type { Email } from '@/lib/jmap/types';
import type { EmailReadView } from '@/lib/plugin-types';

export function emailToReadView(email: Email): EmailReadView {
  return {
    id: email.id,
    threadId: email.threadId,
    mailboxIds: Object.keys(email.mailboxIds || {}).filter(k => email.mailboxIds[k]),
    from: (email.from || []).map(a => ({ name: a.name || '', email: a.email })),
    to: (email.to || []).map(a => ({ name: a.name || '', email: a.email })),
    cc: (email.cc || []).map(a => ({ name: a.name || '', email: a.email })),
    subject: email.subject || '',
    receivedAt: email.receivedAt,
    isRead: !!email.keywords?.['$seen'],
    isFlagged: !!email.keywords?.['$flagged'],
    hasAttachment: email.hasAttachment,
    preview: email.preview || '',
    keywords: Object.keys(email.keywords || {}).filter(k => email.keywords[k]),
    auth: email.authenticationResults,
  };
}
