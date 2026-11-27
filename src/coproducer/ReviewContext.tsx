/**
 * What a screen needs to know about co-producer view, without importing it.
 *
 * Components read this rather than the review-mode module, so a test can
 * render one either way and the owner's app never pays for any of it: outside
 * co-producer view the default value says "inactive" and every function in it
 * does nothing. App provides the real value only in co-producer view.
 */
import { createContext, useContext } from 'react';
import type { ChangeGroup, DownloadAction, ShareAction } from './types';

export type AskRequest = { kind: 'share'; action: ShareAction } | { kind: 'download'; action: DownloadAction };

/** Where a share or download control's own request stands. */
export type ActionState =
  | { state: 'none' }
  /** An ask for it has left this page and has not come back in the list yet. */
  | { state: 'sending' }
  | { state: 'pending' | 'stale' | 'approved' | 'preparing' | 'used' | 'rejected'; requestId: string };

export interface ReviewContextValue {
  /** False everywhere in the owner's app. */
  active: boolean;
  /** The co-producer's name, as the owner typed it. */
  label: string;
  /** When their access ends, as an ISO string. */
  expiresAt: string;
  /**
   * Create a share or download request and show the "Asked for approval" dialog. Never throws: failures show the error dialog.
   * A second ask for an action whose first is still out is ignored (actionState says 'sending' meanwhile).
   */
  ask(request: AskRequest): void;
  /** The newest request for this exact action (outline.action.key === actionKey(action)): what the button that asks for it should say. */
  actionState(action: ShareAction | DownloadAction): ActionState;
  /** Hand over an approved share or download, from the tap that called it. */
  deliver(requestId: string): void;
  /** Open the Pending approval drawer. */
  openPending(): void;
  /** Requests still waiting (pending and stale). */
  pendingCount: number;
}

const NONE: ActionState = { state: 'none' };

const INACTIVE: ReviewContextValue = {
  active: false,
  label: '',
  expiresAt: '',
  ask: () => {},
  actionState: () => NONE,
  deliver: () => {},
  openPending: () => {},
  pendingCount: 0,
};

const ReviewContext = createContext<ReviewContextValue>(INACTIVE);

export const ReviewProvider = ReviewContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useReview(): ReviewContextValue {
  return useContext(ReviewContext);
}

/** Why a request did not reach the owner, in the words the dialog picks. */
export type SendFailure =
  | 'offline'
  | 'too_big'
  | 'too_many_open'
  | 'storage_full_link'
  | 'storage_full_account'
  | 'too_many_files'
  | 'unsupported_media'
  | 'unknown_media'
  | 'invalid'
  | 'no_tape'
  | 'server';

/**
 * Why an edit cannot be sent as it stands: one line per person it brings in
 * without a name, a tape and their social media, or with more than those
 * (newComics.ts). Empty or absent when it can go.
 */
export type SendBlocks = readonly string[];

/** Everyone new in an edit who has no tape, by name: the no-tape sign is up while there is anyone. */
export type NoTape = readonly string[];

/** The proposal dialog's steps: reviewing an edit, sending it, sent, a share or download asked for, a failure, or a draft left unsent. */
export type ProposalDialogState =
  | { step: 'review'; groups: ChangeGroup[]; blocked?: SendBlocks; noTape?: NoTape; send(): void; keepEditing(): void; discard(): void }
  | { step: 'sending'; groups: ChangeGroup[] }
  | { step: 'sent'; groups: ChangeGroup[] }
  | { step: 'asked'; groups: ChangeGroup[] }
  | { step: 'failed'; failure: SendFailure; retry?(): void; discard?(): void }
  | { step: 'restore-draft'; groups: ChangeGroup[]; savedAt: string; blocked?: SendBlocks; noTape?: NoTape; send(): void; discard(): void };
