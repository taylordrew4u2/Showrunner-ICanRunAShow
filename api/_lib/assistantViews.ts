// What an assistant is shown of a show or a Rolodex entry.
//
// Built field by field rather than by copying the decrypted record, so nothing
// new added to a show later reaches a tool result until someone decides it
// should. Never included: uploaded media (headshots, walk-on audio, cue music,
// flyers — data: URLs or media references alike, reported only as present or
// not), the viewer link's token and audio key, and signing-link keys. What is
// included is the producer's own working detail, contacts and notes too,
// because a connection with shows:read was granted to read their shows.
import type { Artist, Performer, PotentialComic, ScheduleItem, Show } from '../../src/types';
import { recapMoney } from '../../src/utils/recapMoney';
import { isSurpriseGuest } from '../../src/utils/surpriseGuests';
import { cipherHash } from './showWrites';

/** The small listing form, as list_shows has always returned it. */
export function showSummary(show: Show) {
  return {
    id: show.id, name: show.name, date: show.date, time: show.time,
    location: show.location, venueName: show.venueName, status: show.status,
    ticketLink: show.ticketLink ?? '', createdAt: show.createdAt, updatedAt: show.updatedAt,
  };
}

/** The profile fields a booking shares with its Rolodex entry, without media. */
function profile(person: Performer | PotentialComic) {
  return {
    name: person.name,
    socialMedia: person.socialMedia,
    email: person.email,
    phone: person.phone,
    notes: person.notes,
    credits: person.credits,
    videoLink: person.videoLink,
    walkOnMusicName: person.walkOnMusicName,
    walkOnMusicArtist: person.walkOnMusicArtist,
    walkOnMusicLink: person.walkOnMusicLink,
    walkOnMusicTimestamp: person.walkOnMusicTimestamp,
    hasPhoto: !!person.photo,
    hasWalkOnAudio: !!person.walkOnMusic,
  };
}

function booking(person: Performer) {
  return { id: person.id, comicId: person.comicId, ...profile(person), surpriseGuest: isSurpriseGuest(person) };
}

function artist(person: Artist) {
  return { ...booking(person), artistType: person.artistType ?? '' };
}

function cue(item: ScheduleItem) {
  return {
    id: item.id, time: item.time, description: item.description,
    performer: item.performer, performerId: item.performerId, durationMin: item.durationMin,
    musicName: item.musicName, hasMusic: !!item.music,
  };
}

/** Everything a producer works with on a show, as get_show and fetch return it. */
export function showDetail(show: Show) {
  return {
    ...showSummary(show),
    host: show.host ?? '',
    performerTarget: show.performerTarget,
    productionNotes: show.productionNotes ?? '',
    hasFlyer: !!show.flyer,
    hasViewerLink: !!show.viewToken,
    viewerNote: show.viewNote ?? '',
    sample: show.sample === true,
    hiddenSections: show.hiddenSections ?? [],
    performers: (show.performers ?? []).map(booking),
    artists: (show.artists ?? []).map(artist),
    schedule: (show.schedule ?? []).map(cue),
    hosts: (show.hosts ?? []).map(host => ({ id: host.id, name: host.name, isHosting: host.isHosting, notes: host.notes })),
    djSongs: (show.djSongs ?? []).map(song => ({ id: song.id, title: song.title, artist: song.artist, notes: song.notes, hasAudio: !!song.music })),
    staff: (show.staff ?? []).map(member => ({ id: member.id, role: member.role, personName: member.personName, phone: member.phone })),
    vendors: (show.vendors ?? []).map(vendor => ({
      id: vendor.id, name: vendor.name, category: vendor.category, contactName: vendor.contactName,
      phone: vendor.phone, email: vendor.email, website: vendor.website, cost: vendor.cost,
      notes: vendor.notes, booked: vendor.booked === true,
    })),
    scenes: show.scenes?.map(scene => ({ id: scene.id, title: scene.title, description: scene.description, duration: scene.duration, status: scene.status })),
    todos: (show.todos ?? []).map(todo => ({ id: todo.id, text: todo.text, completed: todo.completed })),
    recap: {
      attendance: show.recap?.attendance,
      ticketSales: show.recap?.ticketSales,
      merchSales: show.recap?.merchSales,
      otherCosts: show.recap?.otherCosts,
      performerNotes: show.recap?.performerNotes,
      improvementNotes: show.recap?.improvementNotes,
      // Worked out the way the recap page, runsheet and season report work it
      // out, never read from the stored profitLoss.
      money: recapMoney(show.recap, show.vendors ?? []),
    },
  };
}

export function comicSummary(comic: PotentialComic) {
  return { id: comic.id, name: comic.name, socialMedia: comic.socialMedia, email: comic.email, hasPhoto: !!comic.photo };
}

export function comicDetail(comic: PotentialComic) {
  return { id: comic.id, ...profile(comic) };
}

/**
 * A Rolodex entry's revision. Entries share one settings blob, which changes
 * whenever anything in the account does, so an edit is checked against the
 * entry itself rather than the whole blob.
 */
export function comicRevision(comic: PotentialComic): Promise<string> {
  return cipherHash(JSON.stringify(comic));
}

/** One line per detail that has a value, for a document an assistant reads whole. */
function lines(entries: [string, unknown][]): string[] {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `${label}: ${value}`);
}

/**
 * A show as plain text, for fetch: the same details get_show returns, laid out
 * the way a run sheet reads, so a connector that indexes documents can quote it.
 */
export function showText(show: Show): string {
  const detail = showDetail(show);
  const people = (list: (ReturnType<typeof booking> & { artistType?: string })[]) => list.map(person =>
    `- ${person.name}${person.artistType ? ` (${person.artistType})` : ''}${person.surpriseGuest ? ' [surprise guest — keep off anything public]' : ''}` +
    [person.email, person.phone, person.socialMedia].filter(Boolean).map(value => ` · ${value}`).join(''));
  const money = detail.recap.money;
  const sections: [string, string[]][] = [
    ['Lineup', people(detail.performers)],
    ['Artists', people(detail.artists)],
    ['Running order', detail.schedule.map(item => `- ${item.time || '--:--'} ${item.description}${item.performer ? ` — ${item.performer}` : ''}${item.durationMin ? ` (${item.durationMin} min)` : ''}`)],
    ['Hosts', detail.hosts.map(host => `- ${host.name}${host.isHosting ? ' (hosting)' : ''}${host.notes ? ` — ${host.notes}` : ''}`)],
    ['DJ list', detail.djSongs.map(song => `- ${song.title}${song.artist ? ` — ${song.artist}` : ''}`)],
    ['Staff', detail.staff.map(member => `- ${member.role}: ${member.personName}${member.phone ? ` · ${member.phone}` : ''}`)],
    ['Vendors', detail.vendors.map(vendor => `- ${vendor.name}${vendor.category ? ` (${vendor.category})` : ''}${vendor.cost !== undefined ? ` · ${vendor.cost}` : ''}${vendor.booked ? ' · booked' : ''}`)],
    ['To-dos', detail.todos.map(todo => `- [${todo.completed ? 'x' : ' '}] ${todo.text}`)],
    ['Recap', [
      ...lines([['Attendance', detail.recap.attendance]]),
      `Revenue ${money.revenue} (tickets ${money.ticketSales}, merch ${money.merchSales}); costs ${money.costs} (vendors ${money.vendorCosts}, other ${money.otherCosts}); ${money.profitLoss < 0 ? 'loss' : 'profit'} ${Math.abs(money.profitLoss)}`,
      ...lines([['Performer notes', detail.recap.performerNotes], ['What to improve', detail.recap.improvementNotes]]),
    ]],
  ];
  return [
    detail.name,
    ...lines([
      ['Date', detail.date || 'not set'], ['Time', detail.time], ['Venue', detail.venueName], ['Location', detail.location],
      ['Status', detail.status], ['Host', detail.host], ['Tickets', detail.ticketLink], ['Booking target', detail.performerTarget],
      ['Production notes', detail.productionNotes],
    ]),
    ...sections.filter(([, body]) => body.length).flatMap(([title, body]) => ['', title, ...body]),
  ].join('\n');
}

/** A Rolodex entry as plain text, for fetch. */
export function comicText(comic: PotentialComic, bookings: { showName: string; date: string; surpriseGuest: boolean }[]): string {
  const detail = comicDetail(comic);
  return [
    detail.name,
    ...lines([
      ['Social', detail.socialMedia], ['Email', detail.email], ['Phone', detail.phone], ['Credits', detail.credits],
      ['Video', detail.videoLink], ['Walk-on', [detail.walkOnMusicName, detail.walkOnMusicArtist].filter(Boolean).join(' — ')],
      ['Notes', detail.notes],
    ]),
    ...(bookings.length ? ['', 'Booked on', ...bookings.map(b => `- ${b.showName} (${b.date || 'date not set'})${b.surpriseGuest ? ' [surprise guest]' : ''}`)] : []),
  ].join('\n');
}
