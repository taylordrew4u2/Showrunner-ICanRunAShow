/**
 * Handing over a share or download the owner approved, in the co-producer's
 * app.
 *
 * iOS opens a share sheet, a download or a print window only from a fresh
 * tap, so everything that takes waiting for (the photo's bytes, a zip of a
 * bill's headshots, the backup file) is gathered by prepareApproved as soon as
 * the request turns approved. The tap then runs the prepared deliver(), which
 * awaits nothing before it calls the helper that hands the item over, and
 * calls it inside withApprovedDelivery: the one way the delivery gate opens.
 *
 * Every item is built from what the co-producer can already see (truth), and
 * every name from that data: the request names its target by id, never by a
 * photo or a file it carries. A link share hands over the link the owner's
 * app made on approval, from the request's result.
 */
import type { AppSettings, Show } from '../types';
import { deliverFile, type FileDelivery } from '../utils/download';
import { buildDJListText } from '../utils/djListText';
import {
  asShareableFiles,
  canShareFiles,
  chooseDelivery,
  countHeadshots,
  gatherHeadshots,
  headshotZip,
  imageExtension,
  loadHeadshot,
  shareHeadshots,
  singleImageFileName,
  zipFileName,
} from '../utils/headshotExport';
import { dataUrlToFile } from '../utils/media';
import { resolveMediaUrl } from '../utils/mediaStore';
import { exportDJListToPDF, exportShowToPDF } from '../utils/pdfExport';
import { billedPerformers } from '../utils/surpriseGuests';
import { copyText, shareLink, withApprovedDelivery } from './gates';
import type { ApprovalResult, CoproducerRequestDetail, DownloadAction, HeadshotSubject, RequestOutline, ShareAction } from './types';

export type Delivered = 'done' | 'cancelled' | 'failed';

export interface Prepared {
  /** What the control that hands it over says: "Approved — tap to download". */
  label: string;
  /** Hand it over. Call straight from the tap; never rejects. */
  deliver(): Promise<Delivered>;
}

const LABELS = {
  download: 'Approved — tap to download',
  print: 'Approved — tap to print or save',
  copy: 'Approved — tap to copy',
  share: 'Approved — tap to share',
  email: 'Approved — tap to open email',
} as const;

/** The links an approval handed back, each a real http(s) address. */
function resultLinks(result: ApprovalResult | null | undefined): { label: string; url: string }[] {
  const links = Array.isArray(result?.links) ? result.links : [];
  return links.filter((link) => {
    if (typeof link?.label !== 'string' || typeof link.url !== 'string') return false;
    try {
      const url = new URL(link.url);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  });
}

/** Several links go over as one text to copy: the owner's own lines, else one per link. */
function linksText(result: ApprovalResult | null | undefined, links: { label: string; url: string }[]): string {
  return typeof result?.text === 'string' && result.text.trim() ? result.text : links.map((link) => `${link.label} — ${link.url}`).join('\n');
}

/**
 * What a control says once its request is approved. A link share that hands
 * over several links copies them as one text; given no result yet, that is
 * the one that asked for several existing links.
 */
export function approvedLabel(
  action: ShareAction | DownloadAction | NonNullable<RequestOutline['action']>,
  result?: ApprovalResult | null,
): string {
  switch (action.type) {
    case 'runsheet-pdf':
    case 'dj-list-pdf':
      return LABELS.print;
    case 'copy-text':
      return LABELS.copy;
    case 'email':
      return LABELS.email;
    case 'signing-link':
    case 'existing-signing-link':
    case 'profile-link':
    case 'existing-profile-link':
    case 'viewer-link': {
      const several = result ? resultLinks(result).length > 1 : action.type === 'existing-signing-link' && (action.requestIds?.length ?? 0) > 1;
      return several ? LABELS.copy : LABELS.share;
    }
    default:
      return LABELS.download;
  }
}

/** A file handed to the browser's download, or the share sheet in the iOS app. */
async function outcomeOf(delivery: () => Promise<FileDelivery>): Promise<Delivered> {
  try {
    const outcome = await delivery();
    if (outcome === 'downloaded' || outcome === 'shared') return 'done';
    // A share sheet closed, or one that wanted a fresh tap: still approved, tap again.
    if (outcome === 'cancelled' || outcome === 'needs-tap') return 'cancelled';
    return 'failed';
  } catch {
    return 'failed';
  }
}

function fileDownload(blob: Blob, fileName: string): Prepared {
  return {
    label: LABELS.download,
    deliver: () => outcomeOf(() => withApprovedDelivery(() => deliverFile(blob, fileName))),
  };
}

/** A sheet printed from a window the app writes: nothing to wait for, and nothing to say whether it printed. */
function printable(print: () => void): Prepared {
  return {
    label: LABELS.print,
    deliver: async () => {
      try {
        withApprovedDelivery(print);
        return 'done';
      } catch {
        return 'failed';
      }
    },
  };
}

function copying(text: string): Prepared {
  return {
    label: LABELS.copy,
    deliver: async () => {
      try {
        await withApprovedDelivery(() => copyText(text));
        return 'done';
      } catch {
        return 'failed';
      }
    },
  };
}

/** One photo's bytes as a file, or a throw when it would not load (tried again later). */
async function imageFile(photo: string): Promise<{ blob: Blob; extension: string }> {
  const image = await loadHeadshot(photo);
  if (!image || !image.type.toLowerCase().startsWith('image/')) throw new Error('The picture would not load.');
  return { blob: new Blob([image.bytes as BlobPart], { type: image.type }), extension: imageExtension(image.type, image.bytes) };
}

/** Whose headshot, and the photo on file for them, from the co-producer's own view of the account. */
function headshotOf(subject: HeadshotSubject, data: { shows: Show[]; settings: AppSettings }): { name: string; photo: string } | null {
  let person: { name?: string; photo?: string } | undefined;
  if (subject.kind === 'contact') {
    person = data.settings.potentialComics?.find((comic) => comic.id === subject.contactId);
  } else {
    const show = data.shows.find((s) => s.id === subject.showId);
    const people = subject.kind === 'performer' ? show?.performers : show?.artists;
    person = people?.find((p) => p.id === subject.personId);
  }
  const photo = person?.photo?.trim();
  return person && photo ? { name: person.name ?? '', photo } : null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Gather what an approved request hands over, before the tap that hands it
 * over. Null when there is nothing to hand over: an edit, or a target that is
 * no longer in the account (a show, a person, a photo, an agreement, a link
 * that is gone). Rejects when a file would not load, so it can be tried again.
 */
export async function prepareApproved(
  request: CoproducerRequestDetail,
  data: { shows: Show[]; settings: AppSettings },
): Promise<Prepared | null> {
  const payload = request.payload;
  if (payload.kind === 'edit') return null;
  const action = payload.action;
  const showOf = (id: string) => data.shows.find((show) => show.id === id);

  switch (action.type) {
    case 'backup': {
      const file = JSON.stringify(
        { shows: data.shows, settings: data.settings, exportedAt: new Date().toISOString(), sharedBy: 'co-producer view' },
        null,
        2,
      );
      return fileDownload(new Blob([file], { type: 'application/json' }), `showrunner-backup-${today()}.json`);
    }
    case 'headshot': {
      const who = headshotOf(action.subject, data);
      if (!who) return null;
      const { blob, extension } = await imageFile(who.photo);
      return fileDownload(blob, singleImageFileName(who.name, 'headshot', extension));
    }
    case 'flyer': {
      const show = showOf(action.showId);
      const flyer = show?.flyer?.trim();
      if (!show || !flyer) return null;
      const { blob, extension } = await imageFile(flyer);
      return fileDownload(blob, singleImageFileName(show.name, 'flyer', extension));
    }
    case 'headshot-pack': {
      const show = showOf(action.showId);
      if (!show) return null;
      const people = action.includesGuests ? show.performers : billedPerformers(show.performers);
      if (countHeadshots(people) === 0) return null;
      const { files } = await gatherHeadshots(people);
      if (files.length === 0) throw new Error('The headshots would not load.');
      const shareable = asShareableFiles(files);
      const zipName = zipFileName(show.name, { includesGuests: action.includesGuests });
      const asZip = () => outcomeOf(() => withApprovedDelivery(() => deliverFile(headshotZip(files), zipName)));
      const sheet = typeof navigator !== 'undefined' && chooseDelivery({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        canShareFiles: canShareFiles(shareable),
      }) === 'share';
      if (!sheet) return { label: LABELS.download, deliver: asZip };
      return {
        label: LABELS.download,
        deliver: async () => {
          const outcome = await withApprovedDelivery(() => shareHeadshots(shareable)).catch(() => 'failed' as const);
          if (outcome === 'shared') return 'done';
          if (outcome === 'cancelled' || outcome === 'needs-tap') return 'cancelled';
          // No share sheet after all: the zip, as the owner's own button falls back to.
          return asZip();
        },
      };
    }
    case 'signed-agreement': {
      const agreement = data.settings.signedAgreements?.find((a) => a.id === action.agreementId);
      if (!agreement?.fileRef) return null;
      const fileName = agreement.fileName || `${agreement.name || 'Agreement'}.pdf`;
      const url = await resolveMediaUrl(agreement.fileRef);
      const file = url ? dataUrlToFile(url, fileName) : null;
      if (!file) throw new Error('The file would not load.');
      return fileDownload(file, fileName);
    }
    case 'dj-list-text': {
      const show = showOf(action.showId);
      const list = show ? buildDJListText(show, data.settings.musicLibrary ?? []) : null;
      if (!list) return null;
      return fileDownload(new Blob([list.text], { type: 'text/plain' }), list.fileName);
    }
    case 'runsheet-pdf': {
      const show = showOf(action.showId);
      if (!show) return null;
      return printable(() => exportShowToPDF(show, data.settings));
    }
    case 'dj-list-pdf': {
      const show = showOf(action.showId);
      if (!show) return null;
      return printable(() => exportDJListToPDF(show, data.settings.musicLibrary ?? []));
    }
    case 'copy-text':
      return copying(action.text);
    case 'email': {
      const href = action.href;
      if (!/^mailto:/i.test(href)) return null;
      return {
        label: LABELS.email,
        deliver: async () => {
          try {
            window.location.href = href;
            return 'done';
          } catch {
            return 'failed';
          }
        },
      };
    }
    case 'signing-link':
    case 'existing-signing-link':
    case 'profile-link':
    case 'existing-profile-link':
    case 'viewer-link': {
      const links = resultLinks(request.result);
      if (links.length === 0) return null;
      if (links.length > 1) return copying(linksText(request.result, links));
      const [link] = links;
      return {
        label: LABELS.share,
        deliver: async () => {
          try {
            const outcome = await withApprovedDelivery(() => shareLink(link.label, link.url));
            return outcome === 'cancelled' ? 'cancelled' : 'done';
          } catch {
            return 'failed';
          }
        },
      };
    }
  }
}
