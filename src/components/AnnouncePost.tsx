import { useMemo, useState } from 'react';
import type { Show } from '../types';
import { buildSocialPost } from '../utils/socialPost';
import { Modal } from './Modal';
import { Icon } from './Icon';
import './AnnouncePost.css';

interface AnnouncePostProps {
  show: Show;
  onClose: () => void;
}

type Copied = 'none' | 'post' | 'tags' | 'failed';

/**
 * The announcement, written from the booking.
 *
 * Composing one by hand means retyping what the app already knows and then
 * hunting every handle so nobody is left untagged — and the person who gets
 * missed is always the one who notices. Everything here comes off the show
 * record, so it cannot drift out of date, and it stays editable text because
 * the caption is the producer's voice, not the app's.
 */
export function AnnouncePost({ show, onClose }: AnnouncePostProps) {
  const post = useMemo(() => buildSocialPost(show), [show]);
  const [text, setText] = useState(post.text);
  const [copied, setCopied] = useState<Copied>('none');

  async function copy(what: Exclude<Copied, 'none' | 'failed'>, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an
      // insecure origin, a locked-down browser. Say so rather than silently
      // doing nothing; the text is right there to select by hand.
      setCopied('failed');
    }
    setTimeout(() => setCopied('none'), 2500);
  }

  return (
    <Modal onClose={onClose} labelledBy="announce-post-title">
      <div className="announce">
        <div className="announce__head">
          <h2 id="announce-post-title" className="announce__title">
            Post copy
          </h2>
          <p className="announce__sub">
            The bill, the details and every handle — ready to paste.
          </p>
        </div>

        <textarea
          className="announce__text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck
          aria-label="Post caption"
        />

        {post.untagged.length > 0 && (
          <p className="announce__missing">
            <Icon name="alert" size={14} aria-hidden />
            <span>
              No handle saved for {post.untagged.join(', ')} — they won't be tagged until you add
              one to their profile.
            </span>
          </p>
        )}

        <div className="announce__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn--secondary"
            disabled={post.tags.length === 0}
            onClick={() => copy('tags', post.tags.join(' '))}
            title="Just the handles, for a first comment"
          >
            {copied === 'tags' ? 'Copied' : `Copy tags (${post.tags.length})`}
          </button>
          <button className="btn btn--primary" onClick={() => copy('post', text)}>
            {copied === 'post' ? 'Copied' : 'Copy everything'}
          </button>
        </div>

        {copied === 'failed' && (
          <p className="announce__failed" role="status">
            Couldn't reach the clipboard — select the text above and copy it.
          </p>
        )}
      </div>
    </Modal>
  );
}
