/**
 * A show and a settings blob with every field filled in, for the co-producer
 * tests: the schema, the diff, the printable sheets, and (for the builders who
 * come after) the server's redaction and the owner's reversal of it.
 *
 * Typed as `Required<…>` all the way down, so a field added to src/types
 * fails to compile here until it is given a value, and every test that walks
 * these fixtures then has to say what the new field is. Only tests import
 * this file.
 */
import type {
  AppSettings,
  Artist,
  Contract,
  ContractField,
  DeletedItem,
  DJSong,
  EmailListEntry,
  Expense,
  Host,
  MusicTrack,
  Performer,
  PotentialComic,
  Producer,
  ProfileRequest,
  ProfileSubmission,
  Scene,
  ScheduleItem,
  ScheduleTemplate,
  ScheduleTemplateItem,
  SectionCompletions,
  Show,
  ShowRecap,
  SignatureRecord,
  SignatureRequest,
  SignedAgreement,
  StaffMember,
  TodoItem,
  Vendor,
} from '../types';

/** Secrets the fixtures carry, so a test can search output for them. */
export const FIXTURE_SECRETS = {
  viewToken: 'viewtokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  viewerKey: 'viewerkeyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  trashViewToken: 'trashtokenCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  trashViewerKey: 'trashkeyDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
  signToken: 'signtokenEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
  signKey: 'signkeyFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
  profileToken: 'profiletokenGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
  profileKey: 'profilekeyHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH',
} as const;

const person: Required<Performer> = {
  id: 'p1',
  comicId: 'c1',
  name: 'Sam Lee',
  photo: 'media:11111111-aaaa-bbbb-cccc-000000000001#1',
  socialMedia: '@samlee',
  email: 'sam@example.com',
  phone: '555-0100',
  notes: 'Opens strong.',
  walkOnMusic: 'media:11111111-aaaa-bbbb-cccc-000000000002#2',
  walkOnMusicName: 'walkon.mp3',
  walkOnMusicArtist: 'The Band',
  walkOnMusicTimestamp: '0:30',
  walkOnMusicLink: 'https://example.com/track',
  walkOnStartSec: 30,
  walkOnEndSec: 60.5,
  credits: 'As seen on TV.',
  videoLink: 'https://example.com/video',
  surpriseGuest: false,
};

export function fullPerformer(over: Partial<Performer> = {}): Required<Performer> {
  return { ...person, ...over } as Required<Performer>;
}

export function fullArtist(over: Partial<Artist> = {}): Required<Artist> {
  return { ...person, id: 'a1', comicId: 'c2', name: 'Bea Painter', artistType: 'Live painter', ...over } as Required<Artist>;
}

export function fullShow(over: Partial<Show> = {}): Required<Show> {
  const cue: Required<ScheduleItem> = {
    id: 'cue1',
    time: '8:00 PM',
    description: 'Host opens',
    performer: 'Sam Lee',
    durationMin: 5,
    performerId: 'p1',
    music: 'media:11111111-aaaa-bbbb-cccc-000000000003#1',
    musicName: 'open.mp3',
    musicDuration: 20,
    musicStartSec: 1,
    musicEndSec: 21,
  };
  const host: Required<Host> = { id: 'h1', name: 'Cal', notes: 'Knows the room.', isHosting: true };
  const song: Required<DJSong> = {
    id: 'd1',
    title: 'Song One',
    artist: 'Singer',
    notes: 'Play loud.',
    music: 'media:11111111-aaaa-bbbb-cccc-000000000004#1',
    musicName: 'song.mp3',
    libraryId: 'lib1',
    startSec: 2,
    endSec: 62,
  };
  const staff: Required<StaffMember> = { id: 'st1', role: 'Sound', personName: 'Dee', phone: '555-0101' };
  const vendor: Required<Vendor> = {
    id: 'v1',
    name: 'Taco Truck',
    category: 'Catering',
    contactName: 'Eve',
    phone: '555-0102',
    email: 'eve@example.com',
    website: 'https://example.com/tacos',
    cost: 120.5,
    notes: 'Cash only.',
    booked: true,
  };
  const expense: Required<Expense> = { id: 'e1', category: 'Venue', itemName: 'Room hire', cost: 200, date: '2026-08-01', notes: 'Deposit paid.' };
  const scene: Required<Scene> = { id: 'sc1', title: 'Cold open', description: 'Lights down.', duration: 3, status: 'planned', order: 0 };
  const recap: Required<ShowRecap> = {
    attendance: 80,
    ticketSales: 800,
    merchSales: 50,
    otherCosts: 100,
    performerNotes: 'Great energy.',
    improvementNotes: 'Start on time.',
    profitLoss: 629.5,
  };
  const completions: Required<SectionCompletions> = {
    basic: true, performers: true, artists: false, schedule: true, hosts: false, dj: true,
    staff: false, vendors: true, expenses: false, scenes: false, recap: true,
  };
  const todo: Required<TodoItem> = { id: 't1', text: 'Print the run sheet', completed: false };
  return {
    id: 'show1',
    name: 'Friday Laughs',
    date: '2026-08-01',
    time: '8:00 PM',
    location: '1 Main St',
    venueName: 'The Basement',
    status: 'upcoming',
    ticketLink: 'https://example.com/tickets',
    flyer: 'media:11111111-aaaa-bbbb-cccc-000000000005#1',
    performers: [fullPerformer()],
    artists: [fullArtist()],
    schedule: [cue],
    hosts: [host],
    djSongs: [song],
    djHiddenLibraryIds: ['lib2'],
    staff: [staff],
    vendors: [vendor],
    expenses: [expense],
    scenes: [scene],
    recap,
    completions,
    hiddenSections: ['scenes'],
    performerTarget: 6,
    productionNotes: 'Bring the mic stand.',
    host: 'Cal',
    todos: [todo],
    viewToken: FIXTURE_SECRETS.viewToken,
    viewerKey: FIXTURE_SECRETS.viewerKey,
    viewNote: 'Doors at 7:30.',
    sample: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
    ...over,
  } as Required<Show>;
}

export function fullSettings(over: Partial<AppSettings> = {}): Required<AppSettings> {
  const producer: Required<Producer> = { id: 'pr1', name: 'Ada', role: 'Producer' };
  const trash: Required<DeletedItem> = {
    id: 'tr1',
    type: 'show',
    data: fullShow({
      id: 'show-old',
      name: 'Old Show',
      viewToken: FIXTURE_SECRETS.trashViewToken,
      viewerKey: FIXTURE_SECRETS.trashViewerKey,
    }),
    deletedAt: '2026-06-01T10:00:00.000Z',
  };
  const comic: Required<PotentialComic> = {
    id: 'c1',
    name: 'Sam Lee',
    notes: 'Opens strong.',
    socialMedia: '@samlee',
    email: 'sam@example.com',
    phone: '555-0100',
    photo: 'media:11111111-aaaa-bbbb-cccc-000000000001#1',
    credits: 'As seen on TV.',
    walkOnMusic: 'media:11111111-aaaa-bbbb-cccc-000000000002#2',
    walkOnMusicName: 'walkon.mp3',
    walkOnMusicArtist: 'The Band',
    walkOnMusicTimestamp: '0:30',
    walkOnMusicLink: 'https://example.com/track',
    walkOnStartSec: 30,
    walkOnEndSec: 60.5,
    videoLink: 'https://example.com/video',
  };
  const expense: Required<Expense> = { id: 'ge1', category: 'Marketing', itemName: 'Posters', cost: 40, date: '2026-07-10', notes: 'Two sizes.' };
  const email: Required<EmailListEntry> = { id: 'em1', email: 'fan@example.com', addedAt: '2026-07-03T10:00:00.000Z' };
  const templateItem: Required<ScheduleTemplateItem> = { time: '8:00 PM', description: 'Host opens', performer: 'Host', durationMin: 5 };
  const template: Required<ScheduleTemplate> = { id: 'tpl1', name: 'Friday format', items: [templateItem], createdAt: '2026-07-04T10:00:00.000Z' };
  const track: Required<MusicTrack> = {
    id: 'lib1',
    title: 'Library Song',
    artist: 'Band',
    notes: 'Opener.',
    music: 'media:11111111-aaaa-bbbb-cccc-000000000006#1',
    musicName: 'library.mp3',
    addedAt: '2026-07-05T10:00:00.000Z',
    startSec: 0,
    endSec: 30,
  };
  const agreement: Required<SignedAgreement> = {
    id: 'ag1',
    name: 'Venue Agreement',
    category: 'venue',
    counterparty: 'The Basement',
    fileRef: 'media:11111111-aaaa-bbbb-cccc-000000000007#1',
    fileName: 'venue.pdf',
    sizeBytes: 1000,
    uploadedAt: '2026-07-06T10:00:00.000Z',
  };
  const field: Required<ContractField> = { id: 'f1', label: 'Stage name', placeholder: 'As billed', required: true, multiline: false };
  const contract: Required<Contract> = {
    id: 'ct1',
    name: 'Performer Agreement',
    fileRef: 'media:11111111-aaaa-bbbb-cccc-000000000008#1',
    fileName: 'performer.pdf',
    sizeBytes: 2000,
    uploadedAt: '2026-07-07T10:00:00.000Z',
    fields: [field],
  };
  const record: Required<SignatureRecord> = {
    signedAt: '2026-07-09T10:00:00.000Z',
    typedName: 'Sam Lee',
    signerName: 'Sam Lee',
    fields: [{ label: 'Stage name', value: 'Sam' }],
    headshot: 'data:image/png;base64,iVBORw0KGgo=',
    cancellationRuleAcknowledged: 'I will give a day’s notice.',
    documentHash: 'abc123',
    userAgent: 'Test browser',
  };
  const signature: Required<SignatureRequest> = {
    id: FIXTURE_SECRETS.signToken.slice(0, 12),
    token: FIXTURE_SECRETS.signToken,
    key: FIXTURE_SECRETS.signKey,
    contractId: 'ct1',
    contractName: 'Performer Agreement',
    contactId: 'c1',
    signerName: 'Sam Lee',
    signerEmail: 'sam@example.com',
    sentAt: '2026-07-08T10:00:00.000Z',
    signed: record,
    profileFiled: true,
  };
  const submission: Required<ProfileSubmission> = {
    submittedAt: '2026-07-11T10:00:00.000Z',
    typedName: 'Sam',
    fields: [{ label: 'Credits', value: 'TV' }],
    photoChunks: 1,
  };
  const profile: Required<ProfileRequest> = {
    id: FIXTURE_SECRETS.profileToken.slice(0, 12),
    token: FIXTURE_SECRETS.profileToken,
    key: FIXTURE_SECRETS.profileKey,
    contactId: 'c1',
    personName: 'Sam Lee',
    sentAt: '2026-07-10T10:00:00.000Z',
    submitted: submission,
  };
  return {
    brandName: 'Laugh Co',
    producers: [producer],
    rules: 'Be kind.',
    brandBudget: 5000,
    totalSpent: 1200,
    trash: [trash],
    potentialComics: [comic],
    expenses: [expense],
    emailList: [email],
    scheduleTemplates: [template],
    musicLibrary: [track],
    signedAgreements: [agreement],
    contracts: [contract],
    signatureRequests: [signature],
    profileRequests: [profile],
    deletedShowIds: ['show-old'],
    showTypes: ['Comedy'],
    onboarded: true,
    rolodexTermSingular: 'Comic',
    rolodexTermPlural: 'Comics',
    remoteMusicKey: 'PageDown',
    ...over,
  };
}

/** A deep copy through JSON, as every value crossing the wire is. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
