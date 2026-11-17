import { useEffect, useState } from 'react';
import type { ProposalDialogState, SendFailure } from '../../coproducer/ReviewContext';
import { resolveMediaUrl } from '../../utils/mediaStore';
import { timeAgo } from '../../utils/relativeTime';
import { Modal } from '../Modal';
import { useConfirm } from '../useConfirm';
import { ChangeList } from './ChangeList';
import { localConfirm } from './localConfirm';
import './coproducer.css';

/** False while the browser says it is offline. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

type FailureButton = 'retry' | 'discard' | 'pending' | 'ok';

const FAILURES: Record<SendFailure, { text: string; buttons: FailureButton[] }> = {
  offline: { text: "Your change hasn't reached the owner yet. Check your connection and try again.", buttons: ['retry', 'discard'] },
  server: { text: "Your change hasn't reached the owner yet. Check your connection and try again.", buttons: ['retry', 'discard'] },
  too_big: { text: "That's too much to send for approval at once. Send part of it: discard, then make a smaller change.", buttons: ['discard'] },
  too_many_open: { text: 'You have 200 requests waiting. Wait for the owner to go through some, or withdraw a few.', buttons: ['discard', 'pending'] },
  storage_full_link: {
    text: "You've used the space this link has for files and waiting requests. Withdraw some requests, or wait for the owner to go through them.",
    buttons: ['discard', 'pending'],
  },
  storage_full_account: {
    text: "The owner's account has no more room for co-producers' files and requests. They need to go through what's waiting first.",
    buttons: ['discard'],
  },
  too_many_files: { text: 'You have 20 files waiting to be sent. Send or discard your change first.', buttons: ['ok'] },
  unsupported_media: {
    text: "That kind of file can't be sent for approval. Use a photo (JPEG, PNG, WebP or GIF), an audio file or a PDF.",
    buttons: ['ok'],
  },
  unknown_media: { text: 'A file in this change has expired. Discard it and add the file again.', buttons: ['discard'] },
  invalid: { text: "Something in this change can't be sent. Discard it and try again.", buttons: ['discard'] },
};

const TITLE_ID = 'proposal-dialog-title';

/**
 * Every step of sending something to the owner for approval: reviewing an
 * edit before it goes (what is there now, and what is asked for in red),
 * sending, sent, a share or download asked for, a send that failed, and
 * changes left unsent last time.
 */
export function ProposalDialog({ state, onClose, onSeePending, resolveMedia = resolveMediaUrl }: {
  state: ProposalDialogState;
  onClose: () => void;
  onSeePending: () => void;
  /** Previews of photos in the list; the media store's by default. */
  resolveMedia?: (ref: string) => Promise<string | null>;
}) {
  const online = useOnline();
  const { confirm, confirmDialog } = useConfirm();
  const list = (groups: Parameters<typeof ChangeList>[0]['groups']) => <ChangeList groups={groups} resolveMedia={resolveMedia} />;

  const sendButton = (send: () => void) => (
    <>
      {!online && <span className="proposal-dialog__offline" role="status">You're offline</span>}
      <button type="button" className="btn btn--primary" onClick={send} disabled={!online}>
        Send for approval
      </button>
    </>
  );

  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;
  // Escape and the dim page: what backing out means at each step.
  let close = onClose;

  switch (state.step) {
    case 'review': {
      const { send, keepEditing, discard } = state;
      title = 'Send these for approval?';
      close = keepEditing;
      body = (
        <>
          <p className="proposal-dialog__body">Nothing changes until the owner approves. Here's what's there now and what you're asking for:</p>
          {list(state.groups)}
        </>
      );
      const discardAll = async () => {
        const sure = await confirm(localConfirm({ title: 'Discard your changes?', message: "They haven't been sent.", confirmLabel: 'Discard' }));
        if (sure) discard();
      };
      actions = (
        <>
          {/* Keep editing first, so it takes the dialog's first focus rather than the discard. */}
          <button type="button" className="btn btn--secondary" onClick={keepEditing}>Keep editing</button>
          <button type="button" className="btn btn--ghost" onClick={() => void discardAll()}>Discard my changes</button>
          {sendButton(send)}
        </>
      );
      break;
    }
    case 'sending':
      title = 'Sending…';
      // Nothing to back out of: it is on its way.
      close = () => {};
      body = list(state.groups);
      actions = null;
      break;
    case 'sent':
      title = 'Sent for approval';
      body = (
        <>
          <p className="proposal-dialog__body">The owner decides whether this goes in. Until then everything stays as it is, and here's what you asked for:</p>
          {list(state.groups)}
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn--secondary" onClick={onSeePending}>See everything pending</button>
          <button type="button" className="btn btn--primary" onClick={onClose}>OK</button>
        </>
      );
      break;
    case 'asked':
      title = 'Asked for approval';
      body = (
        <>
          <p className="proposal-dialog__body">You'll be able to do this here once the owner approves it.</p>
          {list(state.groups)}
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn--secondary" onClick={onSeePending}>See everything pending</button>
          <button type="button" className="btn btn--primary" onClick={onClose}>OK</button>
        </>
      );
      break;
    case 'failed': {
      const failure = FAILURES[state.failure] ?? FAILURES.server;
      const { retry, discard } = state;
      title = "That didn't send";
      body = <p className="proposal-dialog__body" role="alert">{failure.text}</p>;
      // A share or download that failed has no change to discard: OK closes it instead.
      const wanted = failure.buttons.map((button) => (button === 'discard' && !discard ? 'ok' : button));
      actions = wanted.map((button) => {
        if (button === 'retry') {
          return retry && <button key="retry" type="button" className="btn btn--primary" onClick={retry}>Try again</button>;
        }
        if (button === 'discard') {
          return <button key="discard" type="button" className="btn btn--secondary" onClick={discard}>Discard my change</button>;
        }
        if (button === 'pending') {
          return <button key="pending" type="button" className="btn btn--secondary" onClick={onSeePending}>See everything pending</button>;
        }
        return <button key="ok" type="button" className="btn btn--primary" onClick={onClose}>OK</button>;
      });
      break;
    }
    case 'restore-draft': {
      const { send, discard } = state;
      const saved = Date.parse(state.savedAt);
      title = "Changes you didn't send";
      body = (
        <>
          <p className="proposal-dialog__body">
            You have changes from {Number.isNaN(saved) ? 'earlier' : timeAgo(saved)} that weren't sent. Here they are:
          </p>
          {list(state.groups)}
        </>
      );
      actions = (
        <>
          <button type="button" className="btn btn--secondary" onClick={discard}>Discard</button>
          {sendButton(send)}
        </>
      );
      break;
    }
  }

  return (
    <Modal onClose={close} labelledBy={TITLE_ID}>
      <h2 className="proposal-dialog__title" id={TITLE_ID}>{title}</h2>
      {body}
      {actions && <div className="proposal-dialog__actions">{actions}</div>}
      {confirmDialog}
    </Modal>
  );
}
