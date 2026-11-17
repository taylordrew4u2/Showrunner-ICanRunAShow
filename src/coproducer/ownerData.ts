/**
 * What the owner's app hands the inbox: its latest state, and the three ways
 * an approval writes to it, each through the app's own saves.
 *
 * Kept out of App so the writing rules are tested on their own: commit
 * touches only the shows a plan names and keeps every other show as the
 * owner has it now; a link the server could not withdraw keeps its row, as
 * the Contracts page does it, so its key is never lost; and nothing an
 * approval does deletes a file.
 */
import type { AppSettings, ProfileRequest, Show, SignatureRequest } from '../types';
import { linkStillLive, revokeSignature } from '../utils/contracts';
import { withdrawLiveView } from '../utils/liveView';
import type { SessionCredentials } from '../utils/session-vault';
import type { AppliedPlan } from './applyRequest';
import type { ShareEffect } from './executeShare';
import { withdrawHandoutLinks } from './handouts';
import type { HandoutRefs } from './types';
import type { CommitReport, OwnerDataApi } from './useOwnerRequests';

/** The pieces of App the inbox writes through. */
export interface OwnerAppHooks {
  session: SessionCredentials;
  /** latestShowsRef.current and latestSettingsRef.current. */
  shows(): Show[];
  settings(): AppSettings;
  /** dataLoaded.current. */
  loaded(): boolean;
  producerLocked: boolean;
  syncBlocked(): boolean;
  /** latestShowsRef.current = next; setShows(next): the shows save effect takes it from there. */
  setShows(next: Show[]): void;
  /** setSettings(next) and saveSettings(next). */
  saveSettings(next: AppSettings): void;
  /** App's retireProfileLink: the link and any photo sent through it. */
  retireProfileLink(request: ProfileRequest): void;
  openShow(id: string): void;
  /** For tests; the real ones otherwise. */
  revokeSignature?(request: SignatureRequest, session: SessionCredentials): Promise<void>;
  withdrawLiveView?(token: string, session: SessionCredentials): Promise<void>;
}

/** The inbox's view of the owner's app. */
export function createOwnerData(app: OwnerAppHooks): OwnerDataApi {
  const revoke = app.revokeSignature ?? revokeSignature;
  const withdrawViewer = app.withdrawLiveView ?? withdrawLiveView;

  const putSignatureRequestBack = (request: SignatureRequest) => {
    const latest = app.settings();
    if ((latest.signatureRequests ?? []).some((row) => row.token === request.token)) return;
    app.saveSettings({ ...latest, signatureRequests: [request, ...(latest.signatureRequests ?? [])] });
  };

  return {
    session: app.session,
    shows: app.shows,
    settings: app.settings,
    loaded: app.loaded,
    producerLocked: app.producerLocked,
    syncBlocked: app.syncBlocked,
    openShow: app.openShow,

    async commit(plan: AppliedPlan): Promise<CommitReport> {
      // The plan was made on shows() and settings() in this same tick, so
      // plan.after holds exactly what to write for the shows it touched.
      // Every piece of state is written before the first await.
      const current = app.shows();
      const after = new Map(plan.after.shows.map((show) => [show.id, show]));
      const known = new Set(current.map((show) => show.id));
      const remove = new Set(plan.remove);
      const upsert = new Set(plan.upsert);
      const created = plan.upsert.filter((id) => !known.has(id) && after.has(id)).map((id) => after.get(id)!);
      const next = [
        ...created,
        ...current.filter((show) => !remove.has(show.id)).map((show) => (upsert.has(show.id) && after.has(show.id) ? after.get(show.id)! : show)),
      ];
      if (created.length || remove.size || upsert.size) app.setShows(next);
      if (plan.settingsChanged) app.saveSettings(plan.after.settings);
      const keptLinks: string[] = [];
      for (const withdrawal of plan.withdrawals) {
        if (withdrawal.kind === 'profile') {
          app.retireProfileLink(withdrawal.request);
        } else if (withdrawal.kind === 'viewer') {
          void withdrawViewer(withdrawal.token, app.session).catch(() => {});
        } else {
          // As the Contracts page withdraws one: a link the server could not
          // withdraw keeps its row, so its key is not lost.
          try {
            await revoke(withdrawal.request, app.session);
          } catch (err) {
            if (linkStillLive(err)) {
              putSignatureRequestBack(withdrawal.request);
              keptLinks.push(withdrawal.request.signerName);
            }
          }
        }
      }
      return { keptLinks };
    },

    commitShare(effect: ShareEffect): void {
      if (effect.kind === 'viewer-link') {
        // As the show page files a link it made: onto the show as it is now.
        const now = new Date().toISOString();
        const shows = app.shows();
        if (!shows.some((show) => show.id === effect.showId)) return;
        app.setShows(shows.map((show) => (show.id === effect.showId
          ? { ...show, viewToken: effect.viewToken, viewerKey: effect.viewerKey, updatedAt: now }
          : show)));
        return;
      }
      const latest = app.settings();
      if (effect.kind === 'add-signature-request') {
        app.saveSettings({ ...latest, signatureRequests: [effect.request, ...(latest.signatureRequests ?? [])] });
      } else {
        app.saveSettings({ ...latest, profileRequests: [effect.request, ...(latest.profileRequests ?? [])] });
      }
    },

    withdrawHandout(links: HandoutRefs['links']) {
      return withdrawHandoutLinks(links, {
        state: () => ({ shows: app.shows(), settings: app.settings() }),
        revokeSignature: (request) => revoke(request, app.session),
        retireProfile: (request) => app.retireProfileLink(request),
        withdrawViewer: (token) => withdrawViewer(token, app.session),
        removeSignatureRequests: (tokens) => {
          const gone = new Set(tokens);
          const latest = app.settings();
          app.saveSettings({ ...latest, signatureRequests: (latest.signatureRequests ?? []).filter((row) => !gone.has(row.token)) });
        },
        removeProfileRequests: (tokens) => {
          const gone = new Set(tokens);
          const latest = app.settings();
          app.saveSettings({ ...latest, profileRequests: (latest.profileRequests ?? []).filter((row) => !gone.has(row.token)) });
        },
        clearViewerLinks: (showIds) => {
          // The room's page stops; the show page offers a new link, as for
          // any show without one.
          const ids = new Set(showIds);
          const now = new Date().toISOString();
          app.setShows(app.shows().map((show) => {
            if (!ids.has(show.id)) return show;
            const cleared = { ...show, updatedAt: now };
            delete cleared.viewToken;
            delete cleared.viewerKey;
            return cleared;
          }));
        },
      });
    },
  };
}
