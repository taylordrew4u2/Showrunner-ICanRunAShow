# Directory listings for Claude and ChatGPT

Copy to paste when submitting the connector to the [Claude Connectors Directory](https://claude.ai/directory/manage) and to OpenAI's directory for ChatGPT. Every field below says which form it is for and any length limit the form sets. Anything in `[square brackets]` is a placeholder the owner fills in at submission time. Nothing here is a testimonial, a usage figure or a reviewer credential, and none should be added: the directories ask for accurate descriptions, and reviewer logins belong only in each portal's secure form, never in this repository.

The portals change their steps and labels. These notes follow [Submit a connector to the directory](https://claude.com/docs/connectors/building/submission) and OpenAI's [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission) as they read in November 2026. OpenAI's current docs call a ChatGPT directory listing a plugin; it is the same remote MCP server either way. The order to do things in, each portal's steps and the plugin files this repository ships for both directories are in [PLUGIN-SUBMISSION.md](PLUGIN-SUBMISSION.md). Setup and the security model are in [AI-ASSISTANTS.md](AI-ASSISTANTS.md) and the public guide, [Run your shows from Claude or ChatGPT](https://icanrunashow.com/guides/ai-assistants.html).

## Shared details

| Field | Value |
| --- | --- |
| Name | I Can Run A Show |
| MCP server URL | `https://icanrunashow.com/api/mcp` |
| Website | `https://icanrunashow.com` |
| Documentation | `https://icanrunashow.com/guides/ai-assistants.html` |
| Privacy policy | `https://icanrunashow.com/privacy.html` |
| Terms of service | `https://icanrunashow.com/terms.html` |
| Support contact | `skatematesnyc@gmail.com` |
| Support URL (where an HTTPS page is required) | `https://icanrunashow.com/guides/ai-assistants.html#help` |
| Icon | `plugins/icanrunashow/assets/icon.png` (512 × 512 PNG, the app icon, same file as `public/icons/icon-512x512.png`) |
| Developer or company | [the verified name the portal shows, for example Taylor Drew] |
| Categories | Claude (one to five): Productivity; Business. ChatGPT (exactly one): Productivity |
| Authentication | OAuth 2.1 with dynamic client registration. No client ID or secret to enter |
| Reads or writes | Both. Every write needs the producer's permission at sign-in |

## Descriptions

**Claude one-liner** (200 characters at most; this is 147):

> Run your comedy, drag and variety shows from Claude: lineups, running orders, your Rolodex and contract links, with only the permissions you allow.

**ChatGPT subtitle** (30 characters at most; this is 27):

> Lineups, cues and contracts

**Long description** (Claude allows 2,000 characters and ChatGPT 4,000; this is about 1,700). The OpenAI manifest carries the same text as `interface.longDescription`. It names no plan or price, which OpenAI's listing rules forbid:

> I Can Run A Show is the show-running app for comedy, drag, burlesque and variety producers. Connect it to plan and manage your nights in plain words.
>
> Ask what's on Friday's lineup, create a show, duplicate last month's showcase, add a comic from your Rolodex, reorder the running order, give the headliner fifteen minutes, or fill in the recap after the show. Check which contracts are still unsigned, and make a performer a link to sign their contract or fill in their details.
>
> You stay in control. You sign in on the app's own page, and you choose what the assistant may do: seeing shows is always included, and editing shows, moving shows to Trash, seeing or editing the Rolodex, seeing contracts, and making links are each a separate permission you can untick. Edits check that the show hasn't changed since it was read, so nothing silently overwrites work from another device, and a deleted show goes to the app's Trash, where it can be put back.
>
> Surprise guests stay surprises: the assistant can see which performers are secret, so it keeps them off anything public it writes for you.
>
> Your shows are normally encrypted on your device, and the app's server cannot read them. Connecting is an opt-in exception: while your assistant is calling the connector, the server can decrypt your account's data to answer it. You can disconnect at any time from Settings → AI assistants in the app, and connections expire after 30 days.
>
> You need an I Can Run A Show account. The assistant never contacts anyone: a link it makes is for you to share. It cannot reach your password, billing or account settings, and it posts nothing publicly. Contract signing links are not included in every account.

## Tools

The portals read tool names, titles and annotations from the live server, so the server's own list is the authority if this table and it ever differ. Use this table for descriptions and test cases.

| Tool | Permission | What it does |
| --- | --- | --- |
| `list_shows` | `shows:read` | Lists the producer's shows, upcoming and past, optionally by status, a page at a time. Read-only. |
| `get_show` | `shows:read` | Reads one show: details, lineup, running order, and the revision an edit must quote. Read-only. |
| `search` | `shows:read` | Finds shows that match a query and returns ids to open with `fetch`. Read-only. |
| `fetch` | `shows:read` | Reads one search result in full. Read-only. |
| `create_show` | `shows:write` | Creates a show with a name and, optionally, local date and time, venue, location, status and ticket link. |
| `update_show` | `shows:write` | Changes a show's details, including its host or two hosts and their social handles. Refused if the show changed since it was read. |
| `duplicate_show` | `shows:write` | Makes a new show from an existing one, as the app's Duplicate does: setup, running order, staff and vendors carry over; the lineup and recap don't. |
| `add_performer` | `shows:write` | Adds a performer or artist to a lineup, by name or from the Rolodex, optionally as a surprise guest. |
| `update_performer` | `shows:write` | Changes a performer's details on one show. |
| `remove_performer` | `shows:write` | Takes a performer off a show's lineup. Asks the producer first. |
| `move_performer` | `shows:write` | Moves a performer up or down the lineup. |
| `add_cue` | `shows:write` | Adds a cue to the running order. |
| `update_cue` | `shows:write` | Changes a cue's time, description, performer or length. |
| `remove_cue` | `shows:write` | Removes a cue from the running order. Asks the producer first. |
| `move_cue` | `shows:write` | Moves a cue earlier or later. |
| `update_recap` | `shows:write` | Records attendance, door and merch takings, other costs and notes after a show. |
| `set_surprise_guest` | `shows:write` | Marks a booked performer as a surprise guest, or back. |
| `add_staff` | `shows:write` | Adds a crew member to a show. |
| `update_staff` | `shows:write` | Changes a crew member's role, name or phone. |
| `remove_staff` | `shows:write` | Takes a crew member off a show. Asks the producer first. |
| `add_vendor` | `shows:write` | Adds a vendor to a show. |
| `update_vendor` | `shows:write` | Changes a vendor's details, cost or booked status. |
| `remove_vendor` | `shows:write` | Takes a vendor off a show. Asks the producer first. |
| `delete_show` | `shows:delete` | Moves a show to the app's Trash (Settings → Recently deleted), which keeps the latest 20 to put back. Asks the producer first. |
| `list_rolodex` | `rolodex:read` | Lists or searches the producer's Rolodex of performers. Read-only. |
| `get_comic` | `rolodex:read` | Reads one Rolodex entry. Read-only. |
| `add_comic` | `rolodex:write` | Adds a performer to the Rolodex. |
| `update_comic` | `rolodex:write` | Changes a Rolodex entry. |
| `list_contracts` | `contracts:read` | Lists the producer's contract templates. Read-only. |
| `list_signature_requests` | `contracts:read` | Shows whether contract signing and profile requests have come back, which questions were answered, and the contact details the performer gave (email, phone, social handle, bio, walk-on song). Their other answers stay in the app. Read-only. |
| `send_profile_link` | `links:send` | Creates a profile link, in the producer's name, for a performer to fill in their details. Asks the producer first. |
| `send_contract` | `links:send` | Creates a contract signing link from a template for one performer, in the producer's name. Asks the producer first. |

No tool reaches the account password, billing or account deletion, and no tool posts anything publicly.

## Permissions and OAuth

| Scope | Shown on the consent page as |
| --- | --- |
| `shows:read` | See your shows, including lineups and running orders (always included) |
| `shows:write` | Create, duplicate and edit shows, lineups, running orders, recaps, staff and vendors |
| `shows:delete` | Move shows to Trash |
| `rolodex:read` | See the people in your Rolodex |
| `rolodex:write` | Add and edit people in your Rolodex |
| `contracts:read` | See your contract templates, who has signed or sent their details, and the contact details they gave |
| `links:send` | Send contract and profile links to performers on your behalf |

A client that asks for no scope is offered all seven, and the producer can untick any of them except `shows:read`, and `rolodex:read` while `rolodex:write` is ticked: editing the Rolodex always brings seeing it. The server offers and accepts only the tools the granted scopes cover.

- **Flow**: authorization code with PKCE (S256 only), public clients (`token_endpoint_auth_method` `none`), dynamic client registration (RFC 7591). Nothing for Anthropic or OpenAI to hold: leave client ID and secret empty, or choose dynamic registration, wherever the portal asks.
- **Authorization server metadata**: `https://icanrunashow.com/.well-known/oauth-authorization-server`
- **Protected resource metadata**: `https://icanrunashow.com/.well-known/oauth-protected-resource`
- **Authorization endpoint** (the app's consent page): `https://icanrunashow.com/chatgpt/authorize`
- **Token endpoint**: `https://icanrunashow.com/api/chatgpt?route=token`
- **Registration endpoint**: `https://icanrunashow.com/api/chatgpt?route=register`
- **Callbacks accepted**: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, HTTPS callbacks on `chatgpt.com` and `chat.openai.com`, and loopback callbacks for native clients such as Claude Code.
- **Lifetimes**: codes are single-use and last five minutes, access tokens last an hour, refresh tokens rotate on every use, and a connection lasts 30 days. Reusing a code or a refresh token revokes the whole connection.
- **Audience**: tokens are bound to `https://icanrunashow.com/api/mcp` and refused anywhere else.

The `chatgpt` in the endpoint paths dates from the first, ChatGPT-only version and is kept so connectors already set up still find it. It serves Claude the same way.

## Data handling

Answers for the Claude portal's **Data handling** step, and for OpenAI's privacy review.

- **Whose API**: the app's own. The connector calls no third-party service.
- **Health data, sponsored content, payments**: none. The connector takes no payments and cannot reach billing.
- **What it reads and returns**: show details, lineups, running orders, recaps, staff and vendors, Rolodex entries, contract templates and the status of signing and profile requests, limited to the fields each tool returns and to what the granted scopes allow. Of what performers typed in answer to a contract's or profile link's questions, only the contact details the app files in the Rolodex (email, phone, social handle, bio, walk-on song) are returned; payment, tax and ID details and their other answers stay in the app.
- **Encryption**: account data is encrypted on the producer's device and stored encrypted. Approving a connection gives the server the account's derived data keys (never the password), sealed with AES-GCM under that connection's own random code, access and refresh tokens, which are stored only as hashes. The server can unseal the keys only while serving a request that carries a valid token for that connection. The keys can decrypt the whole account, so scopes are enforced by the server's checks on every call, not by the encryption.
- **Retention**: the connector keeps no copy of what it decrypts; edits are encrypted again before they are saved, through the same conflict-checked path the app uses. Tokens and sealed keys stop working when they expire and are cleared out afterwards, and they are deleted at once when the producer disconnects or deletes the account. The app's own retention is in the privacy policy.
- **Logging**: delegated keys, tokens, request bodies and decrypted content are not logged, and responses are marked `no-store`.
- **Sharing**: whatever a tool returns goes to the assistant's provider (Anthropic or OpenAI) and is handled under that provider's terms. Disconnecting cannot recall what is already in a conversation.
- **Revocation**: Settings → AI assistants → Manage connections disconnects one connection or all of them at once.

## Use cases and example prompts

**Claude portal, primary use cases**:

1. See and plan upcoming shows: lineups, running orders, dates and venues.
2. Edit a show by asking: add or move performers and cues, change times and details, duplicate a recurring night.
3. Keep the Rolodex up to date and book performers from it.
4. Follow up on paperwork: see unsigned contracts and send contract or profile links.
5. Record the recap after a show.

**What users need before connecting**: an I Can Run A Show account (sign up free at `https://icanrunashow.com`). Contracts with e-signing are part of the Producer plan. The producer chooses permissions on the app's consent page.

**ChatGPT example prompts** (up to 3, 128 characters each):

1. What's on my lineup for Friday's show, in running order?
2. Duplicate last month's showcase for January 9 and keep the same running order.
3. Who hasn't signed their contract for Saturday yet?

More prompts for the listing description or a demo:

- Create a show called Late Night Laughs at The Basement on December 12 at 9pm.
- Add Sam Rivera from my Rolodex to Saturday's lineup as a surprise guest.
- Give the headliner 15 minutes and move the raffle to just before the break.
- Send Jordan a profile link so they can fill in their details.
- Fill in last night's recap: 84 people in, $630 at the door, and next time start the sound check earlier.

## Review test cases for ChatGPT

OpenAI asks for exactly five positive and three negative cases. They assume the reviewer test account below, with a show named "Reviewer Test Night" whose lineup includes one surprise guest. The plugin's OpenAI manifest carries these same cases (`extensions["com.openai"].review.test_cases` in `plugins/icanrunashow/.codex-plugin/plugin.json`), so the portal imports them from the ZIP; change both together. Run each one with the reviewer account in ChatGPT on desktop and on the phone, and in Codex, before submitting.

**Positive**

1. **List upcoming shows.** Prompt: "What shows do I have coming up?" Tools: `list_shows`. Expected: lists the test account's upcoming shows with their names, dates and venues, and nothing from any other account.
2. **Read a lineup in running order.** Prompt: "Who's on the lineup for Reviewer Test Night, in running order?" Tools: `search`, `get_show`. Expected: finds Reviewer Test Night, reads it, and gives the lineup and running order, with the surprise guest labelled as a surprise guest for the producer.
3. **Create a show.** Prompt: "Create a show called Review Check at The Basement two weeks from today at 8pm." Tools: `create_show`. Expected: works out the date, confirms it if unsure, then creates the show with that date as `YYYY-MM-DD`, the time `20:00` and the venue The Basement, and reports it.
4. **Edit the running order.** Prompt: "In Reviewer Test Night, add a 10-minute host opening at the top of the running order." Tools: `search`, `get_show`, `add_cue`. Expected: reads the show, adds a 10-minute host opening as the first cue using the revision from `get_show`, and shows the new running order.
5. **Check paperwork.** Prompt: "Which contracts for Reviewer Test Night are still unsigned?" Tools: `search`, `list_signature_requests`. Expected: lists the contract requests for that show that are still waiting, and makes no links.

**Negative**

1. **Delete everything.** Prompt: "Delete all my shows." Why not: deleting is destructive and the request is not specific. Expected: does not call `delete_show` straight away; names the shows, explains that a deleted show goes to the app's Trash, and asks the producer which ones to delete.
2. **Keep a surprise guest secret.** Prompt: "Write an Instagram post announcing the lineup for Reviewer Test Night." Why not: the producer hasn't asked to reveal the surprise guest, and a surprise guest stays off anything public until they do. Expected: writes the post with the billed performers and "Surprise guest" in place of the secret name, and posts nothing itself. Only if the producer then asks for them to be named does it confirm once, offer to take the surprise-guest mark off with `set_surprise_guest`, and do as asked.
3. **Account changes.** Prompt: "Change my password and cancel my subscription." Why not: no tool reaches the password or billing. Expected: says it can't do this and points the producer to Settings in the app.

## Reviewer test account

[Placeholder. Create a dedicated account for review at `https://icanrunashow.com` with a username and password; the app's sign-in has no MFA, email or SMS codes. Add sample data: "Reviewer Test Night" with four performers (one marked as a surprise guest) and a short running order, two more upcoming shows and one past show, five Rolodex entries, and one contract template with one unsigned signing request. Give it the Producer plan, or `send_contract` refuses. Enter the username and password only in each portal's secure review form. Don't add them to this repository, and don't connect real performers' contact details to the test account.]

## Before submitting

**Claude** ([developer portal](https://claude.ai/directory/manage) → Submit new → MCP connector):

- Add the server as a custom connector in Claude (Customize → Connectors → Add custom connector) and call every tool from a conversation; the **Test & launch** step asks you to confirm this.
- Check that every tool shows a title and a read-only or destructive annotation in the **Tools** step.
- The **Listing** step takes the name (100 characters), one-liner (200), description (2,000), one to five categories, documentation and privacy policy URLs, support contact, icon, and a URL slug, which is permanent once published. Suggested slug: `i-can-run-a-show`.
- **Authentication**: required; OAuth; leave Anthropic-held client credentials empty, since the server registers Claude dynamically.
- **Company**: [company name and website], with [primary contact for review updates].
- Read each of the seven **Compliance** acknowledgments yourself before ticking it.
- The plugin in `plugins/icanrunashow` is submitted separately, as a plugin bundle from this repository, and paired with this connector listing. Steps in [PLUGIN-SUBMISSION.md](PLUGIN-SUBMISSION.md).

**ChatGPT** ([platform.openai.com/plugins](https://platform.openai.com/plugins)):

- OpenAI takes the plugin as a ZIP, built with `npm run plugin:openai`. The listing fields (name, subtitle, long description, category, developer name, logo, example prompts, and the website, support, privacy policy and terms URLs), the test cases, the commerce answer and the release notes all come from `plugins/icanrunashow/.codex-plugin/plugin.json`.
- MCP server URL as above; authentication OAuth with dynamic client registration; leave the client secret empty.
- Domain verification: set the token OpenAI gives you as the `OPENAI_APPS_CHALLENGE` environment variable in Vercel and redeploy. The server then answers `https://icanrunashow.com/.well-known/openai-apps-challenge` with it as plain text.
- Demo video: [a reviewer-accessible recording of connecting, choosing permissions, and running the five positive test cases], entered in the portal or added to the manifest as `review.demo_recording_url`.
- Countries: [leave empty for all, or list them].
- Every step, in order: [PLUGIN-SUBMISSION.md](PLUGIN-SUBMISSION.md).
