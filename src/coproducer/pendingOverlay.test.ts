import { describe, expect, it } from 'vitest';
import { buildPendingOverlay, editLanded } from './pendingOverlay';
import { clone, fullPerformer, fullSettings, fullShow } from './testFixtures';
import type { CoproducerRequestDetail, EditPayload, RequestPayload, RequestStatus } from './types';

const truth = { shows: [fullShow()], settings: fullSettings() };
const comic = truth.settings.potentialComics[0];

function request(id: string, payload: RequestPayload, status: RequestStatus = 'pending', createdAt = '2026-11-01T10:00:00.000Z'): CoproducerRequestDetail {
  return {
    id,
    kind: payload.kind,
    status,
    createdAt,
    decidedAt: null,
    usedAt: null,
    outline: { kind: payload.kind },
    result: null,
    payload,
  };
}

/** The venue changed, Sam's email changed, a performer added, and Sam taken out of the Rolodex. */
const venueAndLineup: EditPayload = {
  kind: 'edit',
  shows: [{
    target: 'show',
    op: 'update',
    showId: 'show1',
    baseRevision: 'r1',
    keys: ['venueName', 'performers'],
    base: { venueName: 'The Basement', performers: [fullPerformer()] },
    proposed: {
      venueName: 'The Attic',
      performers: [fullPerformer({ email: 'sam@new.example' }), fullPerformer({ id: 'p2', comicId: 'c9', name: 'Jo Park' })],
    },
  }],
  settings: {
    target: 'settings',
    baseRevision: 's1',
    fields: [{
      field: 'potentialComics',
      kind: 'rows',
      idField: 'id',
      baseOrder: ['c1'],
      proposedOrder: [],
      base: [['c1', comic]],
      proposed: [],
    }],
  },
};

const newShow: EditPayload = {
  kind: 'edit',
  shows: [{ target: 'show', op: 'create', showId: 'new1', show: fullShow({ id: 'new1', name: '  Sunday Set ', viewToken: undefined, viewerKey: undefined }) }],
  settings: null,
};

const rename: EditPayload = {
  kind: 'edit',
  shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: 'r1', keys: ['name'], base: { name: 'Friday Laughs' }, proposed: { name: 'Saturday Laughs' } }],
  settings: null,
};

const details = [
  request('b', newShow, 'stale', '2026-11-02T10:00:00.000Z'),
  request('a', venueAndLineup),
  request('c', rename, 'approved'),
  request('d', { kind: 'download', action: { type: 'flyer', showId: 'show1' } }),
];

describe('the pending overlay', () => {
  const overlay = buildPendingOverlay(details, truth);

  it('files each change of an open edit under its group', () => {
    const keys = overlay.marks('show:show1').map((mark) => mark.change.key);
    expect(keys).toContain('venueName');
    expect(keys).toContain('performers/p1/email');
    expect(keys).toContain('performers/p2');
    expect(overlay.marks('show:show1').every((mark) => mark.requestId === 'a' && mark.status === 'pending' && mark.groupKey === 'show:show1')).toBe(true);
  });

  it('finds the marks under a place by path prefix', () => {
    expect(overlay.marks('show:show1', 'venueName').map((m) => m.change.key)).toEqual(['venueName']);
    const lineup = overlay.marks('show:show1', 'performers').map((m) => m.change.key);
    expect(lineup.length).toBeGreaterThan(1);
    expect(lineup.every((key) => key.startsWith('performers/') || key.startsWith('performers#'))).toBe(true);
    expect(overlay.marks('show:show1', 'performers/p1').map((m) => m.change.key)).toEqual(['performers/p1/email']);
    // A prefix is a whole segment: p1 is not under p10.
    expect(overlay.marks('show:show1', 'performers/p').length).toBe(0);
    expect(overlay.marks('show:show1', 'location')).toEqual([]);
  });

  it('marks a row the request removes, for the row to be struck through', () => {
    const marks = overlay.marks('settings:potentialComics', 'potentialComics/c1');
    expect(marks.some((mark) => mark.change.key === 'potentialComics/c1' && mark.change.change === 'removed')).toBe(true);
  });

  it('lists the shows open requests would create, named, once', () => {
    expect(overlay.newShows).toEqual([{ requestId: 'b', showId: 'new1', name: 'Sunday Set' }]);
    expect(overlay.marks('show:new1').every((mark) => mark.status === 'stale')).toBe(true);
  });

  it('leaves out requests that are no longer open, and shares and downloads', () => {
    expect(overlay.marks('show:show1').some((mark) => mark.requestId === 'c')).toBe(false);
    expect(overlay.marks('download')).toEqual([]);
    expect(overlay.marks('share')).toEqual([]);
  });

  it('gives the same answer to the same question', () => {
    expect(overlay.marks('show:show1', 'performers')).toBe(overlay.marks('show:show1', 'performers'));
    expect(overlay.marks('show:nope')).toBe(overlay.marks('show:other', 'x'));
  });

  it('lists marks oldest request first', () => {
    const both = buildPendingOverlay(
      [request('late', rename, 'pending', '2026-11-03T10:00:00.000Z'), request('early', venueAndLineup)],
      truth,
    );
    const ids = both.marks('show:show1').map((mark) => mark.requestId);
    expect(ids[0]).toBe('early');
    expect(ids[ids.length - 1]).toBe('late');
  });

  it('does not list a new show the account already has', () => {
    const overlay2 = buildPendingOverlay([request('b', newShow)], { ...truth, shows: [...truth.shows, fullShow({ id: 'new1' })] });
    expect(overlay2.newShows).toEqual([]);
  });

  it('names a new show with no name', () => {
    const unnamed = clone(newShow);
    if (unnamed.shows[0].op === 'create') unnamed.shows[0].show.name = '';
    expect(buildPendingOverlay([request('b', unnamed)], truth).newShows[0].name).toBe('Untitled show');
  });
});

describe('whether an approved edit is in the account', () => {
  it('is not, while the account still holds what was there', () => {
    expect(editLanded(venueAndLineup, truth)).toBe(false);
    expect(editLanded(newShow, truth)).toBe(false);
    expect(editLanded(rename, truth)).toBe(false);
  });

  it('is, once every changed value, row and removal reads as proposed', () => {
    const after = clone(truth);
    after.shows[0].venueName = 'The Attic';
    after.shows[0].performers = [
      fullPerformer({ email: 'sam@new.example', notes: 'The owner changed this meanwhile.' }),
      fullPerformer({ id: 'p2', comicId: 'c9', name: 'Jo Park' }),
    ];
    after.shows[0].updatedAt = '2026-11-05T00:00:00.000Z';
    after.settings.potentialComics = [];
    expect(editLanded(venueAndLineup, after)).toBe(true);

    after.settings.potentialComics = [comic];
    expect(editLanded(venueAndLineup, after)).toBe(false);
  });

  it('takes rows the owner added beside the change as in', () => {
    const after = clone(truth);
    after.shows[0].venueName = 'The Attic';
    after.shows[0].performers = [
      fullPerformer({ id: 'p0', name: 'Owner Added' }),
      fullPerformer({ email: 'sam@new.example' }),
      fullPerformer({ id: 'p2', comicId: 'c9', name: 'Jo Park' }),
    ];
    after.settings.potentialComics = [];
    expect(editLanded(venueAndLineup, after)).toBe(true);
  });

  it('checks creates and deletes by whether the show is there', () => {
    expect(editLanded(newShow, { ...truth, shows: [...truth.shows, fullShow({ id: 'new1' })] })).toBe(true);
    const deletion: EditPayload = { kind: 'edit', shows: [{ target: 'show', op: 'delete', showId: 'show1', baseRevision: 'r1', base: fullShow() }], settings: null };
    expect(editLanded(deletion, truth)).toBe(false);
    expect(editLanded(deletion, { ...truth, shows: [] })).toBe(true);
  });

  it('checks words added to and taken from a list', () => {
    const types: EditPayload = {
      kind: 'edit',
      shows: [],
      settings: { target: 'settings', baseRevision: 's1', fields: [{ field: 'showTypes', kind: 'value', base: ['Comedy'], proposed: ['Comedy', 'Improv'] }] },
    };
    expect(editLanded(types, truth)).toBe(false);
    expect(editLanded(types, { ...truth, settings: fullSettings({ showTypes: ['Improv', 'Comedy', 'Music'] }) })).toBe(true);
  });
});
