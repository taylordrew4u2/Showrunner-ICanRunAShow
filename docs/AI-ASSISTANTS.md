# Connect Claude and ChatGPT

I Can Run A Show exposes one authenticated Model Context Protocol (MCP) server at `/api/mcp`. Claude and ChatGPT both connect to it as a custom connector, sign in through OAuth, and get only the permissions the producer ticks on the app's consent page. It is a remote MCP connector, not the retired ChatGPT plugin manifest format, and it does not publish a directory listing automatically.

The connector URL for the hosted app is:

```
https://icanrunashow.com/api/mcp
```

A self-hosted deployment uses its own origin. Settings → **AI assistants** → **Connect Claude or ChatGPT** shows the URL for the app you are signed in to.

## Before you connect

Deploy the web app and its Vercel API with the normal Turso configuration, and set `APP_URL` to the canonical HTTPS origin, for example `https://icanrunashow.com`. The Vite development server alone does not run the API, and an assistant cannot reach a local development address.

## Claude

### Claude on the web, Desktop and mobile

Connectors you add in Claude are shared by claude.ai, the Desktop app and the mobile apps.

1. In Claude, open **Customize → Connectors** ([claude.ai/customize/connectors](https://claude.ai/customize/connectors)) and choose **Add custom connector**. On Team and Enterprise plans an owner may need to add it for the organization first.
2. Name it (for example "I Can Run A Show") and paste the connector URL. Leave the OAuth client on its default, or choose **Register automatically**: this server registers Claude itself through dynamic client registration, so there is no client ID or secret to enter.
3. Choose **Connect**. Claude opens the app's authorization page. Sign in to your show account, untick anything you don't want to allow, and press **Allow access**. Claude returns to `https://claude.ai/api/mcp/auth_callback`.
4. Turn the connector on in a conversation and ask, for example, "What's on my lineup for Friday?" or "Add Sam Rivera to the Rolodex."

### Claude Code

```
claude mcp add --transport http icanrunashow https://icanrunashow.com/api/mcp
```

Then run `/mcp` in Claude Code, pick `icanrunashow` and authenticate. Claude Code opens the authorization page in your browser and waits for the callback on a loopback address on your computer (`http://localhost:<port>/callback` or `http://127.0.0.1:<port>/callback`, a different port each time). Because any program on a computer can listen on a loopback port and register under any name, the consent page says plainly when a request returns to this computer. Allow it only if you just started connecting from Claude Code or another app you trust there.

## ChatGPT

1. In ChatGPT, go to [chatgpt.com/plugins](https://chatgpt.com/plugins), choose **+**, then **Add custom MCP server**. Name it, paste the connector URL, choose **OAuth** authentication, and choose **Create as a plugin**. Labels and availability depend on your ChatGPT plan and workspace policy.
2. Connect it, sign in to your show account on the app's authorization page, choose what to allow and press **Allow access**.
3. Add it to a conversation and ask, for example, "List my upcoming shows" or "Create a show called Friday Comedy for December 4, 2026 at 8pm." Ask ChatGPT to confirm the local date and time if it is ambiguous.

**Connected ChatGPT before now? Connect once more.** The first ChatGPT connections sealed their keys in a way a copy of the database alone could open (see [The trust trade-off](#the-trust-trade-off)). The server no longer opens those seals and deletes them, with the connections they belonged to, so each existing ChatGPT connection stops working and has to be connected again, once, through the consent page. A connection made since keys have been sealed the current way is not affected.

## Permissions

Every connection can see shows. Everything else is a separate OAuth scope, and the consent page lists each one the assistant asked for as a checkbox, ticked to start with. What is ticked when **Allow access** is pressed is exactly what the connection gets. A client that asks for no particular scope is offered all of them.

| Scope | On the consent page | What it allows |
| --- | --- | --- |
| `shows:read` | See your shows, including lineups and running orders (always included) | List, search and read shows |
| `shows:write` | Create, duplicate and edit shows, lineups, running orders, recaps, staff and vendors | Create, update and duplicate shows; edit performers and surprise guests, cues, the recap, staff and vendors |
| `shows:delete` | Move shows to Trash | Delete a show the way the app does: it goes to Settings → Recently deleted, which keeps the latest 20 to put back, without walk-on audio |
| `rolodex:read` | See the people in your Rolodex | List and search the Rolodex |
| `rolodex:write` | Add and edit people in your Rolodex | Add and update Rolodex entries. Always comes with `rolodex:read`, since an edit shows what is in the Rolodex: the consent page ticks and locks that box while this one is ticked |
| `contracts:read` | See your contract templates, who has signed or sent their details, and the contact details they gave | List contract templates and the status of signing and profile requests, with which questions were answered and the contact details the performer gave: email, phone, social handle, bio and walk-on song. Their other answers, such as payment or tax details, stay in the app |
| `links:send` | Send contract and profile links to performers on your behalf | Create profile (details) links and contract signing links in your name |

A connection is offered only the tools its scopes cover, and the server refuses a call to any other tool even if a client sends one directly. No scope reaches the account password, billing or account deletion.

Connections made before these scopes existed could only see and edit shows. They were all sealed the first way (see [The trust trade-off](#the-trust-trade-off)), so they are removed rather than carried over, and none reaches the wider set of tools without the producer consenting to it on the consent page. A refresh can never widen a connection. To allow more, disconnect it and connect again.

Reload an already-open browser app to see changes made through an assistant. The app's existing save-conflict protection stops a stale browser edit from silently replacing a newer assistant edit.

## Tools

Each tool needs `shows:read` plus the one permission listed beside it. `tools/list` shows only what the connection was granted, and every call is checked again, so a tool the producer did not allow is refused even if a client calls it directly.

| Permission | Tools | Behavior |
| --- | --- | --- |
| `shows:read` | `list_shows`, `get_show`, `search`, `fetch` | `list_shows` pages the account's shows (follow `next_cursor` even when a filtered page is empty). `get_show` returns the whole show: the host and, when two share the night, the second host, each with their social handle (`host`, `hostSocial`, `coHost`, `coHostSocial`), lineup with surprise-guest marks and contacts, artists, running order, hosts, DJ list, staff, vendors, to-dos, private notes, and the recap with revenue, costs and profit worked out as the recap page works them out. It returns the revision every edit needs. `search`/`fetch` use the shapes ChatGPT's connectors and deep research expect (`show:<id>` and, with `rolodex:read`, `comic:<id>`). |
| `shows:write` | `create_show`, `update_show`, `duplicate_show`, `add_performer`, `update_performer`, `remove_performer`, `move_performer`, `set_surprise_guest`, `add_cue`, `update_cue`, `remove_cue`, `move_cue`, `update_recap`, `add_staff`/`update_staff`/`remove_staff`, `add_vendor`/`update_vendor`/`remove_vendor` | `update_show` changes a show's details, private notes and its hosts: `host` and `hostSocial` for the first, `coHost` and `coHostSocial` for a second, at most two. An empty name clears that host with their handle, and a second host left alone becomes the host. A different name over a host the producer picked from the Rolodex is a different person, so that host's Rolodex handle goes with the old name; a handle needs a host to belong to. The older patch with only `host` works as it did. Each tool makes the edit the app's own screen makes and saves it the way the app saves one: walk-on rows on the DJ list follow the lineup, a booked person's profile edits reach their Rolodex entry and other bookings (which also needs `rolodex:write`), new names are filed in the Rolodex, the recap's stored profit stays true, and duplicating follows the app's Duplicate. A new name typed over someone from the Rolodex is refused until the producer says whether it is the same person or a different act, as the app asks. `remove_performer`, `remove_cue`, `remove_staff` and `remove_vendor` need `confirm: true`, which the assistant is told to pass only once the producer has said yes; without it they are refused, as `delete_show` is. A show's audience viewer link is published by the app, never by these tools, so when a show has one and a lineup edit changes its public bill (who is on it, their names, credits or order, or a surprise-guest mark), the result carries a note telling the producer to open the show in the app, which brings the public page up to date. Until then it shows the lineup as it was, including anyone just made a surprise guest. |
| `shows:delete` | `delete_show` | Moves the show to Settings → Recently deleted exactly as the app's Delete does, so it can be restored there. Never deletes permanently: a full Recently deleted (20 shows) is refused rather than pushing the oldest out. Needs `confirm: true`. |
| `rolodex:read` | `list_rolodex`, `get_comic` | Searches the Rolodex and reads an entry with the shows they are booked on. |
| `rolodex:write` | `add_comic`, `update_comic` | Adds an entry (refusing a second one under the same name) or edits one, carrying the edit to every booking as the app does when the Rolodex is saved. |
| `contracts:read` | `list_contracts`, `list_signature_requests` | Contract templates with their questions and how many came back, and who was sent which contract or profile link, whether it has come back, and each booked person's paperwork on a show. Once the app has filed a signed contract or a profile's details, `list_signature_requests` lists each question with only whether it was answered, and the contact details the app files into the Rolodex from the answers, read the way the app reads them: email, phone, social handle, credits or bio, and walk-on song name. No other answer is returned, however the question is worded: payment, tax and ID details and everything else stay in the app, under More → Contracts. A question asking for an ID number, even as briefly as "Social #" or "Social (for the 1099)", or about paying them, such as a Venmo handle or a credit union account, is never read as a contact detail. |
| `links:send` | `send_profile_link`, `send_contract` | Makes the same links the app makes (a fresh token and key, the key only in the link's fragment, counted against the account's link storage) and files them so the app lists them and can withdraw them. Both need `confirm: true`, and nobody is contacted: the link is returned for the producer to share. A contract whose PDF is larger than about 9 MB is refused with directions to send it from the app. `send_contract` is a Producer feature, as Send is in the app: on an account on the free plan that is not a founding member (one made before subscriptions started), it is refused with a message that the account's current plan doesn't include it. The message stops there, without pointing to an upgrade, because OpenAI's plugin rules don't allow a tool to promote one. `send_profile_link` stays free. |

Every write takes `expected_revision` (from `get_show`, `get_comic` or the previous write) and is refused, never merged over, when the record has changed since. Settings are written only over the version that was read. Tool results never include uploaded media (reported only as present or not), viewer-link tokens or audio keys, contract documents, signers' headshots, performers' answers other than the contact details above, or the keys of links already sent. Account, billing and the music library are not available to assistants.

Reload an already-open browser app to see changes made through an assistant. Its existing save-conflict protection prevents stale browser edits from silently replacing a newer connector edit.

## Disconnecting

Open **Settings → AI assistants → Manage connections**. Each connection is listed with its client name, its permissions in words, when it was connected and when it expires.

- **Disconnect** on a connection revokes that connection alone: its grant, access token and refresh token are deleted at once, and the assistant's next request is refused. Other connections keep working.
- **Disconnect all** revokes every assistant connection on the account.

Connections expire 30 days after they are made and must then be authorized again. Deleting the account removes every connection. Removing the connector inside Claude or ChatGPT stops that app using it, but only disconnecting here revokes the credentials on the app's side. Disconnecting does not remove information already shared into an assistant conversation; that stays with the assistant's provider.

## The trust trade-off

Normal browser use decrypts data on the device, and the server holds only ciphertext. An assistant connection is an explicit, opt-in exception to that, and it is worth understanding before you allow one.

- **What is delegated.** Approving sends the account's derived encryption keys to the app's server. The password is never sent. The keys are what the browser itself uses, so they can cryptographically unlock everything encrypted under the account (shows, settings, the Rolodex, contracts and signed records), not just what the ticked scopes cover. The scopes are enforced by the server's checks on every tool call, not by the encryption.
- **How the keys are kept.** The database stores OAuth credentials only as hashes, and stores the delegated keys as AES-GCM ciphertext wrapped under the random authorization code, access token or refresh token they belong to, with a key derived from that credential (HKDF-SHA-256 under its own label) rather than the hash the database keeps for it. A copy of the database alone cannot unwrap them. Seals made before that derivation used the credential's bare SHA-256, which is also its stored hash, so the server no longer opens them: a credential sealed that way is refused as if it did not exist and deleted, with its connection once nothing sealed the current way is left under it, by the clean-up that runs on every registration, consent and token request and by any request that presents one. Those connections have to be made again.
- **When the server decrypts.** Only while serving a request carrying a valid access token for that connection: the server unwraps the keys, decrypts the records the tool reads (shows, and for any tool that touches the Rolodex, contracts, links or Trash or edits a lineup, the whole settings record, which keeps those together with signed records), returns a limited set of fields to the assistant, and encrypts any edit before writing it through the same compare-and-swap path the browser uses. Keys, tokens, request bodies and decrypted content are not logged, and responses are marked `no-store`.
- **What the assistant's provider sees.** Whatever the tools return goes to Anthropic (Claude) or OpenAI (ChatGPT) and is then handled under that provider's own terms and retention.
- **What a stolen token can do.** An access token lasts an hour. Whoever holds one can call every tool the connection's scopes allow, as you, until it expires or you disconnect: read shows, the Rolodex, contract status and the contact details performers gave (email, phone, social handle, bio, walk-on song; never their other answers, such as payment or tax details), and, if those scopes were ticked, edit, move shows to Trash or create links. A stolen refresh token can mint new access tokens for the rest of the 30 days, until it or its successor is used twice (the replay revokes the whole connection) or you disconnect. A token cannot change the password, billing or account, cannot reach another account, and never returns the keys themselves. Someone who has both a live token and a copy of the database, or who controls the running server, can recover that connection's keys.
- **What limits the damage.** Tick only what you need, disconnect connections you no longer use, and disconnect at once if you suspect a token has leaked. Access tokens are short-lived, refresh tokens rotate on every use, codes are single-use and expire in five minutes (a code used twice revokes the connection it made), and every token is bound to this server's `/api/mcp` audience.

Do not enable a connection if you need the keys never to leave your device.

## Protocol and validation

- Stateless Streamable HTTP JSON-RPC at `/api/mcp`, with authenticated `initialize`, `ping`, `tools/list` and `tools/call`.
- OAuth authorization server metadata at `/.well-known/oauth-authorization-server` and protected-resource metadata at `/.well-known/oauth-protected-resource` (also the `/api/mcp` suffix variant). Both list every scope in `scopes_supported`. Every other `/.well-known/` address, `/.well-known/openid-configuration` included, is a JSON 404 rather than the app's page, except `/.well-known/openai-apps-challenge`, which answers with the `OPENAI_APPS_CHALLENGE` environment variable as plain text (OpenAI's domain check for a plugin) and is a 404 while that is unset.
- `initialize` returns `serverInfo` with a title, description, website and the app icon, and instructions kept under 512 characters. Every tool in `tools/list` carries an `outputSchema` for its `structuredContent` (`api/_lib/assistantOutputs.ts`), OpenAI's `securitySchemes` naming the scopes it needs, and its title both as `title` and as `annotations.title`, which clients on protocols before 2025-06-18 read instead. Every write that overwrites or removes something, moves and the surprise-guest mark included, is marked `destructiveHint: true`; only purely additive writes are not. A call refused for a missing scope also returns `_meta["mcp/www_authenticate"]`, an `insufficient_scope` challenge naming the connection's scopes plus the missing one, which ChatGPT can turn into a sign-in prompt.
- Public-client dynamic client registration (RFC 7591) with `token_endpoint_auth_method` `none`. Client ID Metadata Documents are not supported, so Claude falls back to dynamic registration. A registered client is kept for 90 days from when it was last used: registering it, and every code redeemed or refresh made through it, push its expiry out (never in), and never to before the connection that redemption or refresh belongs to ends. ChatGPT registers once per connector and reuses that client for everyone who connects through it, so a client in use does not lapse; one nobody uses for 90 days is removed.
- Registered callbacks must be one of: ChatGPT's own callback, `https://chatgpt.com/connector_platform_oauth_redirect` or `https://chatgpt.com/connector/oauth/<id>` (or the same on `chat.openai.com`), with no query; exactly `https://claude.ai/api/mcp/auth_callback` or `https://claude.com/api/mcp/auth_callback`; or a loopback callback `http://127.0.0.1:<port>/<path>` or `http://localhost:<port>/<path>` for native clients (RFC 8252). A loopback callback matches its registration on any port, as RFC 8252 section 7.3 requires; host, path and query must still match. Fragments, credentials in the URL, other hosts, other paths on ChatGPT's hosts and plain HTTP anywhere else are refused: registration is open to anyone, so a callback that could land on some other page would let a stranger who started the flow, and so holds its PKCE verifier, collect the code.
- The authorization-code flow requires PKCE S256 from every client, loopback ones included. Codes are one-use and last five minutes; access tokens last an hour; refresh tokens rotate. A replayed code or refresh token revokes its whole connection, every token issued under it included (RFC 6749 section 4.1.2).
- Scope: any space-separated subset that includes `shows:read`; an unknown scope is `invalid_scope`; no scope means all of them. `rolodex:write` always brings `rolodex:read`. Grants store scopes in one canonical order. A refresh may omit the scope or repeat the granted set; anything else is `invalid_scope`.
- The `resource` parameter, when sent, must be this server's `/api/mcp` URL, and tokens are only accepted for that audience.
- Browser requests are accepted from the app's own origin and from `chatgpt.com`, `chat.openai.com`, `platform.openai.com` (OpenAI's plugin portal, which connects and scans tools from the browser), `claude.ai` and `claude.com`. The owner-only routes (consent and connection management) accept only the app's own origin and use the account's existing app credentials, which are never sent to an assistant. `DELETE /api/chatgpt?route=connections&id=<grant id>` revokes one connection; without `id` it revokes all of them.
- Registration is rate-limited to 30 per hour and token requests to 300 per hour per client address. Claude and ChatGPT reach the server from shared addresses, so a busy deployment may need these raised.

Internal names (the `chatgpt_*` tables, `api/chatgpt.ts`, `/chatgpt/authorize`) date from the first, ChatGPT-only version and are kept so connectors already set up in ChatGPT still find them.

The deployed HTTPS endpoint and real Claude and ChatGPT account connections need a separate live check after deployment. Passing the local suites does not establish deployment, directory approval or workspace availability.

Run `npm test` and `npm run lint` for server and utility checks. With Chromium installed, `PW_CHROMIUM_PATH=/usr/bin/chromium npm run e2e -- e2e/chatgpt.spec.ts --workers=2` exercises the consent and disconnect UI against the hermetic API fixture. Server tests use isolated local databases and exercise the real schema, token lifecycle and encrypted writes.

References: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Claude connector authentication](https://claude.com/docs/connectors/building/authentication), [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252), [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples).
