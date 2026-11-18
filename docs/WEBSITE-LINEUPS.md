# Website lineup feed

The optional `/api/website-lineups` feed keeps an approved website's show lineups current without a desktop watcher. It uses the existing API and Turso database; no additional paid service or model call is required.

This is an explicit public publication surface. Private show records remain encrypted. Only configured source shows can publish their public details and billed performers into a separate plaintext projection. The initial Pins and Needles integration covers four selected canonical source shows, not recovered copies, undated records, or every show in the producer's account.

## Configure the server

Set these variables on the I Can Run A Show API deployment, without a `VITE_` prefix:

| Variable | Purpose |
| --- | --- |
| `WEBSITE_LINEUPS_SHOW_IDS` | JSON array of the exact approved stable source show IDs. Titles and dates do not establish identity. |
| `WEBSITE_LINEUPS_READ_TOKEN` | A new random token of at least 32 characters. This authorizes only reading the approved public projections. |
| `WEBSITE_LINEUPS_SETUP_TOKEN` | A different random token of at least 32 characters, used for one initial seed. Remove it after setup succeeds. |

Leave the configuration unset to disable the integration. Do not reuse a producer password, OAuth token, account key, viewer audio key, or database credential for either token. Store the read token only in the consuming website's server environment, never in a `NEXT_PUBLIC_` variable or browser bundle. The setup token must not be given to the website.

Changing or rotating the setup token does not reset the database's consumed-bootstrap record. Do not delete that record to retry a successful setup.

## Establish the initial public projection

1. Use the producer's existing authorized native MCP connection to call `get_show` for every approved source ID. Keep its returned `revision` alongside the public projection.
2. Select only the public fields below. Exclude every performer marked `surpriseGuest`; retain the billed performers' saved order. Do not send the full `get_show` result to this endpoint or save it in the seed file.
3. POST one complete seed containing every configured source ID exactly once. Send the setup token in the `Authorization: Bearer <token>` header and JSON with `Content-Type: application/json`.
4. After a successful response, GET the feed with the read token and verify all approved shows. Then remove the setup token from the API deployment.

The POST body is an object with exactly one `shows` array. Each array item has this shape; the values below are illustrative placeholders, not a real show or a ready-to-submit revision:

```json
{
  "id": "approved-source-show-id",
  "revision": "0000000000000000000000000000000000000000000000000000000000000000",
  "name": "Public show title",
  "date": "2027-01-01",
  "time": "20:00",
  "venueName": "Public venue name",
  "location": "Public venue location",
  "ticketLink": "",
  "status": "upcoming",
  "lineup": [
    { "id": "optional-booking-id", "name": "Billed performer", "credits": "Public credit" }
  ]
}
```

Wrap the complete approved set as `{"shows":[...the approved show objects...]}`. `revision` is the current 64-character lowercase SHA-256 revision returned by `get_show`. Performer `id` and `credits` are optional. `status` is one of `upcoming`, `in-progress`, `completed`, or `cancelled`. `hosts` is optional: one or two objects, each `{ "name": "...", "handle": "@...", "link": "https://..." }` with `handle` and `link` optional, for whoever is hosting. Leave out a host who is also the show's surprise guest. Do not include contacts, production notes, media, surprise-guest names, signing links or keys.

The API verifies that the IDs exactly match the allowlist, all source records belong to one owner, and every revision matches the current encrypted source record. It commits the seed and consumes bootstrap together. A stale revision, missing or extra ID, duplicate ID, mixed owner, invalid payload or failed transaction does not partially publish the seed. A successful bootstrap cannot be submitted again.

## Read from the website

Make a server-to-server GET to `https://icanrunashow.com/api/website-lineups` with `Authorization: Bearer <WEBSITE_LINEUPS_READ_TOKEN>`. Forward only the returned public data through the website's own server route. Do not forward the integration token or producer credentials to visitors.

The response contains:

```json
{
  "version": 1,
  "updatedAt": "2027-01-01T00:00:00.000Z",
  "shows": [
    {
      "id": "approved-source-show-id",
      "name": "Public show title",
      "date": "2027-01-01",
      "time": "20:00",
      "venueName": "Public venue name",
      "location": "Public venue location",
      "ticketLink": "",
      "status": "upcoming",
      "lineup": [{ "name": "Billed performer" }],
      "available": true
    },
    { "id": "another-approved-source-show-id", "available": false }
  ]
}
```

`updatedAt` can be `null` before a projection is available. A successful, available show with an empty `lineup` is different from an unavailable show.

Keep this live overlay separate from the website's editable content store. Preserve its branding and existing public descriptions, and join source shows by their stable IDs. Fetch current data on page render and refresh the public overlay every 30 seconds while the page is open, including when it becomes visible again. This is polling, not instant push delivery; the initial seed is the only step that needs the Mac.

When a row becomes unavailable or disappears, clear its old lineup. Do not fall back to a cached lineup or manual performer names: those names may have just been removed or made a surprise guest. Treat authentication and fetch failures as unavailable rather than as proof that the last lineup is current.

## How writes stay in step

The normal encrypted source record remains authoritative. A current browser learns the owner's approved IDs from the optional `websiteLineupShowIds` field in authenticated `/api/shows` responses. It sends a small public projection alongside a changed approved show's ciphertext; unrelated shows send no projection. MCP writes construct the same projection from the already authorized, decrypted show.

The shared compare-and-swap write transaction updates both records together. A stale or conflicting save changes neither. An actual legacy ciphertext change without a matching projection invalidates the approved show's public projection, and deletion removes or invalidates its feed data. This fails closed when an older app cannot supply current public data.

The signed-in owner's app also reconciles the approved projections automatically after loading, on return or reconnection, and once a minute while visible and online. Transient failures retry with a 5-second backoff that grows to at most a minute. No sync button, Mac process, or repeat setup is needed. This reads fresh saved rows rather than the working draft; it does not reload shows or settings into the editor or change its save baselines.

For that repair, authenticated `GET /api/shows?websiteLineups=1` returns only the owner's initialized, approved publication rows. The app decrypts these with its existing local key and sends `PUT /api/website-lineups` with the same item shape as the seed, limited to a nonempty subset of those rows. PUT requires the normal owner `x-user-id` and `x-auth` headers; neither integration token authorizes it. The server checks publication membership, ownership and every current ciphertext revision together before changing projections. A stale batch changes nothing and is retried from a fresh read. Identical projections preserve their existing timestamps. A publication repair never changes the encrypted source or creates a new publication.

App updates are also automatic when the owner is on an idle, fully saved dashboard. A form, dialog, active audio, live show, local-only work or failed save keeps the existing reload prompt instead. Safety is checked again when the service worker takes control; another tab's update cannot restart this tab.

The feed does not decrypt arbitrary stored records, extract or retain producer OAuth credentials, depend on the Mac watcher, or overwrite `/api/live` audience timer and audio state. Changing the approved set is a publication-scope change; do not broaden it to unrelated shows to make a missing lineup appear.
