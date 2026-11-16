// What each assistant tool returns, as the outputSchema tools/list declares.
//
// Every tool answers with structuredContent (and the same JSON as text), and
// the MCP spec and OpenAI's plugin reference ask a tool that does to declare
// its shape. A client may check a result against it and reject one that does
// not match, so these describe only the top level each tool always returns,
// leave nested records open, and never forbid extra properties: a schema
// stricter than the result would turn a working tool into an error.
// src/utils/serverAssistantOutputs.test.ts calls every tool and checks its
// result against the schema here.

type Schema = Record<string, unknown>;

function shape(properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema {
  return { type: 'object', properties, required };
}

const show: Schema = { type: 'object', description: 'The show as get_show returns it: details, lineup, running order, staff, vendors and recap.' };
const revision: Schema = { type: 'string', description: 'Pass as expected_revision to the next change to this record.' };
const notes: Schema = { type: 'array', items: { type: 'string' }, description: 'Things the producer should be told, such as an audience viewer link that is now behind.' };
const nextCursor: Schema = { type: ['string', 'null'], description: 'Pass as cursor for the next page; null on the last page.' };
const message: Schema = { type: 'string', description: 'What to tell the producer.' };

/** A show after a change: the show, its new revision and any notes. */
function edited(extra: Record<string, Schema> = {}): Schema {
  return shape({ show, revision, notes, ...extra }, ['show', 'revision', ...Object.keys(extra)]);
}

const SHOW_EDIT_TOOLS = [
  'create_show', 'update_show', 'duplicate_show',
  'update_performer', 'remove_performer', 'move_performer', 'set_surprise_guest',
  'update_cue', 'remove_cue', 'move_cue', 'update_recap',
  'update_staff', 'remove_staff', 'update_vendor', 'remove_vendor',
] as const;

export const OUTPUT_SCHEMAS: Record<string, Schema> = {
  list_shows: shape({ shows: { type: 'array', items: { type: 'object' }, description: 'Show details without lineups, contacts, notes or media.' }, next_cursor: nextCursor }),
  get_show: shape({ show, revision }),
  search: shape({
    results: {
      type: 'array',
      items: shape({ id: { type: 'string', description: 'Pass to fetch.' }, title: { type: 'string' }, url: { type: 'string' } }),
    },
  }),
  fetch: shape({
    id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, url: { type: 'string' },
    metadata: { type: 'object', description: 'kind, the show or Rolodex id, and for a show its date, status and revision.' },
  }),
  ...Object.fromEntries(SHOW_EDIT_TOOLS.map(name => [name, edited()])),
  add_performer: edited({ bookingId: { type: 'string', description: 'The new booking’s performer_id on this show.' } }),
  add_cue: edited({ cueId: { type: 'string', description: 'The new cue’s cue_id.' } }),
  add_staff: edited({ staffId: { type: 'string', description: 'The new staff_id.' } }),
  add_vendor: edited({ vendorId: { type: 'string', description: 'The new vendor_id.' } }),
  delete_show: shape({
    deleted: shape({ id: { type: 'string' }, name: { type: 'string' } }),
    trashId: { type: 'string' },
    message,
  }),
  list_rolodex: shape({ comics: { type: 'array', items: { type: 'object' } }, next_cursor: nextCursor }),
  get_comic: shape({ comic: { type: 'object' }, bookings: { type: 'array', items: { type: 'object' }, description: 'The shows this person is booked on.' }, revision }),
  add_comic: shape({ comic: { type: 'object' }, revision }),
  update_comic: shape({ comic: { type: 'object' }, revision, notes }, ['comic', 'revision']),
  list_contracts: shape({ contracts: { type: 'array', items: { type: 'object' } } }),
  list_signature_requests: shape({
    requests: { type: 'array', items: { type: 'object' } },
    next_cursor: nextCursor,
    lineup: { type: 'array', items: { type: 'object' }, description: 'With show_id: each booked person’s paperwork on that show.' },
  }, ['requests', 'next_cursor']),
  send_profile_link: shape({
    url: { type: 'string', description: 'The link, for the producer to share. Nobody has been contacted.' },
    person: { type: 'object' },
    sentAt: { type: 'string' },
    message,
  }),
  send_contract: shape({
    url: { type: 'string', description: 'The signing link, for the producer to share. Nobody has been contacted.' },
    contract: { type: 'object' },
    signer: { type: 'object' },
    forShow: { type: 'string' },
    prefilled: { type: 'array', items: { type: 'string' }, description: 'The questions already answered from the show.' },
    sentAt: { type: 'string' },
    message,
  }, ['url', 'contract', 'signer', 'prefilled', 'sentAt', 'message']),
};
