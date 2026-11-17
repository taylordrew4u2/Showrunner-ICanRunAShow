/**
 * The small description of a request that lists show: which shows it
 * touches, which settings fields, or which share or download it asks for.
 *
 * Made by the server from the validated payload when a request arrives, and
 * again by the owner's app from the payload it validates itself, so what a
 * card says comes from the request's typed fields. Free text the co-producer
 * wrote (a copy-text's text, an email's address line, a signer's typed name
 * and email) never goes into an outline: both apps name things from their
 * own data. The one exception is the name a new show is created with, which
 * nobody else's data holds yet.
 */
import { seg } from './paths';
import type { DownloadAction, RequestOutline, RequestPayload, ShareAction } from './types';

/**
 * One key per action, so a share or download button can find its own
 * request: 'download:flyer:<showId>',
 * 'download:headshot:performer:<showId>:<personId>',
 * 'share:existing-signing-link:<sorted ids>'. Ids are path segments
 * (encodeURIComponent), so no id can run into the next part. Free text never
 * enters it: the same button asks for the same thing whatever was typed.
 */
export function actionKey(action: ShareAction | DownloadAction): string {
  switch (action.type) {
    case 'copy-text':
      return `share:copy-text:${action.source}:${seg(action.showId ?? '')}`;
    case 'email':
      return `share:email:${action.source}:${seg(action.showId ?? '')}`;
    case 'signing-link':
      return `share:signing-link:${seg(action.contractId)}:${seg(action.signer.contactId ?? '')}`;
    case 'existing-signing-link':
      return `share:existing-signing-link:${[...action.requestIds].sort().map(seg).join(',')}`;
    case 'profile-link':
      return `share:profile-link:${seg(action.contactId)}`;
    case 'existing-profile-link':
      return `share:existing-profile-link:${seg(action.requestId)}`;
    case 'viewer-link':
      return `share:viewer-link:${seg(action.showId)}`;
    case 'backup':
      return 'download:backup';
    case 'headshot': {
      const subject = action.subject;
      return subject.kind === 'contact'
        ? `download:headshot:contact:${seg(subject.contactId)}`
        : `download:headshot:${subject.kind}:${seg(subject.showId)}:${seg(subject.personId)}`;
    }
    case 'headshot-pack':
      return `download:headshot-pack:${seg(action.showId)}:${action.includesGuests ? 'with-guests' : 'billed'}`;
    case 'flyer':
    case 'dj-list-text':
    case 'runsheet-pdf':
    case 'dj-list-pdf':
      return `download:${action.type}:${seg(action.showId)}`;
    case 'signed-agreement':
      return `download:signed-agreement:${seg(action.agreementId)}`;
  }
}

type OutlineAction = NonNullable<RequestOutline['action']>;

function outlineAction(action: ShareAction | DownloadAction): OutlineAction {
  const out: OutlineAction = { type: action.type, key: actionKey(action) };
  switch (action.type) {
    case 'copy-text':
    case 'email':
      if (action.showId !== undefined) out.showId = action.showId;
      break;
    case 'signing-link':
      out.contractId = action.contractId;
      if (action.signer.contactId !== undefined) out.contactId = action.signer.contactId;
      break;
    case 'existing-signing-link':
      out.requestIds = [...action.requestIds];
      break;
    case 'existing-profile-link':
      out.requestIds = [action.requestId];
      break;
    case 'profile-link':
      out.contactId = action.contactId;
      break;
    case 'headshot':
      out.subject = { ...action.subject };
      if (action.subject.kind !== 'contact') out.showId = action.subject.showId;
      break;
    case 'signed-agreement':
      out.agreementId = action.agreementId;
      break;
    case 'backup':
      break;
    default:
      out.showId = action.showId;
  }
  return out;
}

/** The outline of a validated payload. */
export function buildOutline(payload: RequestPayload): RequestOutline {
  if (payload.kind === 'edit') {
    const outline: RequestOutline = {
      kind: 'edit',
      shows: payload.shows.map((edit) =>
        edit.op === 'create' ? { id: edit.showId, op: 'create', createName: edit.show.name } : { id: edit.showId, op: edit.op },
      ),
    };
    if (payload.settings) outline.settingsFields = payload.settings.fields.map((field) => field.field);
    return outline;
  }
  return { kind: payload.kind, action: outlineAction(payload.action) };
}
