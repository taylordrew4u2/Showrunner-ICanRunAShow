# Submitting the plugin to ChatGPT and Claude

Step by step, how to get I Can Run A Show listed in OpenAI's plugin directory (ChatGPT and Codex) and in Anthropic's directory (Claude), with the value for every field. The text to paste (descriptions, use cases, data-handling answers, test cases) is in [ASSISTANT-LISTINGS.md](ASSISTANT-LISTINGS.md); this page is the order to do things in and what each portal checks. How the connector works and its security model are in [AI-ASSISTANTS.md](AI-ASSISTANTS.md).

These notes follow the official pages listed under [Sources](#sources), as they read on November 16, 2026. Both portals change their labels and steps; when a portal disagrees with this page, follow the portal and correct this page.

Nothing here submits anything. Every step below is for the owner, signed in to each portal. Reviewer logins never go in this repository: only in each portal's secure form.

## What the repository provides

One plugin folder serves both directories. Each directory reads its own manifest, and both share the connector, the skill and the icon.

| Path | What it is | Read by |
| --- | --- | --- |
| `plugins/icanrunashow/.claude-plugin/plugin.json` | Claude plugin manifest, with the directory's listing URLs and icon | Claude Code, claude.ai, Anthropic's directory |
| `plugins/icanrunashow/.codex-plugin/plugin.json` | OpenAI plugin manifest (Codex format): listing (`interface`), review test cases and release notes (`extensions["com.openai"]`) | OpenAI's plugin portal, Codex |
| `plugins/icanrunashow/.mcp.json` | The connector: one remote server, `https://icanrunashow.com/api/mcp`, no credentials. The ZIP's copy also declares how OpenAI signs in (step 1) | Both |
| `plugins/icanrunashow/skills/run-a-show/SKILL.md` | The skill: the producer's instructions come first; read before editing, confirm once before deleting or making links, and keep surprise guests secret unless the producer asks to name them | Both |
| `plugins/icanrunashow/assets/icon.png` | The app icon, 512 × 512 PNG (the same file as `public/icons/icon-512x512.png`): Claude's plugin icon, OpenAI's logo and composer icon | Both |
| `plugins/icanrunashow/README.md` | What the plugin does, how to start, and what it sends where, with Claude first and ChatGPT and Codex under "Other assistants". Anthropic's directory shows it as the plugin's description | Both |
| `.claude-plugin/marketplace.json` | The repository as a Claude Code marketplace | Claude Code, claude.ai |
| `.agents/plugins/marketplace.json` | The repository as a Codex marketplace | Codex, the ChatGPT desktop app |
| `scripts/build-openai-plugin.mjs` (`npm run plugin:openai`) | Builds the ZIP OpenAI takes, without `.claude-plugin/` and with OpenAI's sign-in declaration in its `.mcp.json` | You, before uploading |
| `api/mcp.ts`, `api/_lib/assistantOutputs.ts` | The server's title, icon and instructions, and every tool's output schema and permissions | Both portals' tool scans |
| `api/chatgpt.ts` (`/.well-known/openai-apps-challenge`) | OpenAI's domain check, answered from the `OPENAI_APPS_CHALLENGE` environment variable | OpenAI's portal |

`src/utils/pluginPackaging.test.ts` and `src/utils/serverAssistantListing.test.ts` check these against each other and against the server: the manifests' required fields and limits, matching versions, the icon's size, the ZIP's contents, that every tool has an output schema its results match, and that the tool table below lists every tool with the server's own hints.

## 1. Before either portal

1. **Deploy this branch to production** at `https://icanrunashow.com`, with `APP_URL` set to `https://icanrunashow.com`. Both portals read the live server. Check it from a terminal:

   ```
   curl -s https://icanrunashow.com/.well-known/oauth-protected-resource
   curl -s https://icanrunashow.com/.well-known/oauth-authorization-server
   curl -si https://icanrunashow.com/.well-known/openid-configuration | head -1    # HTTP/2 404
   curl -si -X POST https://icanrunashow.com/api/mcp | grep -i www-authenticate     # Bearer resource_metadata=...
   ```

   The connector's address can never change for an OpenAI plugin: a different scheme, host or port means a new plugin. Keep `https://icanrunashow.com`, without `www`.

2. **Run the checks**: `npm test`, `npm run lint`, and, with Claude Code installed, `claude plugin validate ./plugins/icanrunashow --strict` and `claude plugin validate .`. Both validations passed on November 16, 2026 with Claude Code 2.1.325.

3. **Make a reviewer account.** At `https://icanrunashow.com`, create an account used only for review, with a username and password. The app's sign-in has no MFA, email or SMS codes, which OpenAI requires of a test account. Give it the sample data the test cases use: a show called "Reviewer Test Night" with four performers, one of them marked as a surprise guest, and a short running order; two more upcoming shows and one past show; five Rolodex entries with made-up details; and one contract template with one unsigned signing request. Give it the Producer plan, or `send_contract` refuses: subscribe it, or give it a row in the `subscription` table with the status `active`. Keep it working after launch: both directories re-test listed plugins. Write the username and password only into each portal's review form, never into this repository, a commit or an issue.

4. **Check the policy pages name you.** OpenAI checks that the privacy policy and terms name the same publisher as the verified identity you submit under. `public/privacy.html` and `public/terms.html` name the service, not its operator. Add the operator's name (yours, or your company's) to both before submitting, and read the privacy policy's "Information about other people" and "Who handles your information" sections, added for this submission, to confirm they are right.

5. **Test every tool by hand**, as both portals ask you to confirm:
   - MCP Inspector: `npx @modelcontextprotocol/inspector`, transport Streamable HTTP, URL `https://icanrunashow.com/api/mcp`, then sign in with the reviewer account and run each tool.
   - Claude: Customize → Connectors ([claude.ai/customize/connectors](https://claude.ai/customize/connectors)) → Add custom connector, with the connector address. Run the five positive test cases.
   - ChatGPT: [chatgpt.com/plugins](https://chatgpt.com/plugins) → **+** → Add custom MCP server, with the connector address and OAuth, then Create as a plugin. Run the five positive and three negative test cases on desktop and on the phone app.

## 2. ChatGPT and Codex: OpenAI's plugin directory

One listing covers ChatGPT and Codex. OpenAI calls it a plugin; it is a ZIP with the manifest, the skill and the icon, plus the connector, which OpenAI connects to and scans.

### Prerequisites (OpenAI Platform)

- **Verify the publisher.** At [platform.openai.com/settings/organization/general](https://platform.openai.com/settings/organization/general), complete individual verification to publish under your own name, or business verification to publish under a company's. The listing's developer name comes from this identity.
- **Permissions.** An organization owner can submit. Anyone else needs Apps Management read and write (`api.apps.read`, `api.apps.write`).
- **Project.** Use a project with global data residency: projects with EU data residency cannot submit a plugin with an MCP server.
- Use the same organization for every later update: the plugin and its server address belong to it.

### Step 1: build the ZIP

1. In `plugins/icanrunashow/.codex-plugin/plugin.json`, set `author.name` and `interface.developerName` to the verified identity's name, exactly. Both say `Taylor Drew` now. If you change them, change `author.name` in `.claude-plugin/plugin.json` to match: the tests keep the two manifests' authors equal.
2. Optional: once the demo video is recorded (see step 4), add its URL to the manifest as `extensions["com.openai"].review.demo_recording_url`, or enter it in the portal instead.
3. Run `npm run plugin:openai`. It writes `dist-plugin/icanrunashow-1.0.0.zip` (the folder is git-ignored) holding:

   ```
   .codex-plugin/plugin.json
   .mcp.json
   README.md
   assets/icon.png
   skills/run-a-show/SKILL.md
   ```

   `.claude-plugin/` is left out on purpose: OpenAI's docs don't say which manifest wins when an archive has both.

   Every file is copied as it is in the folder except `.mcp.json`. OpenAI reads how to sign in to a server from that server's entry, so the ZIP's copy adds this to the `icanrunashow` server, and nothing else:

   ```json
   "extensions": { "com.openai": { "auth": { "type": "oauth", "client": { "mode": "dcr" } } } }
   ```

   That is OAuth with dynamic client registration, so there is no client ID or secret anywhere. The folder's own `.mcp.json` stays without it, as Claude reads it. The tests check the ZIP's copy against the folder's.

### Step 2: upload it

1. Go to [platform.openai.com/plugins](https://platform.openai.com/plugins) and choose **Upload new or existing plugin** (some pages call it **Create plugin**, then **With MCP**).
2. Pick the verified developer identity and upload the ZIP.
3. Under **Metadata & Skills**, wait for the metadata and skill scans. The skill's security scan can take up to two hours. If either reports issues, choose **Copy issues**, fix them here, raise `version` in both plugin manifests, rebuild and upload again. Every re-upload must keep the name `icanrunashow` and have a higher version.

The listing comes from the manifest:

| Portal field | Value | Limit |
| --- | --- | --- |
| Display name | I Can Run A Show | 30 |
| Short description | Lineups, cues and contracts | 30 |
| Long description | `interface.longDescription`, the same text as the long description in ASSISTANT-LISTINGS.md | 4,000 |
| Developer name | The verified identity (OpenAI overwrites the manifest's) | 80 |
| Category | Productivity | one |
| Capabilities | Read, Write | |
| Website | `https://icanrunashow.com` | HTTPS |
| Support | `https://icanrunashow.com/guides/ai-assistants.html#help` | HTTPS |
| Privacy policy | `https://icanrunashow.com/privacy.html` | HTTPS |
| Terms of service | `https://icanrunashow.com/terms.html` | HTTPS |
| Example prompts | The three ChatGPT example prompts in ASSISTANT-LISTINGS.md | 3, 128 each |
| Brand colors | `#0d0c0b` (light), `#f5f3ee` (dark): the app's ink and ivory | 2:1 contrast |
| Logo and composer icon | `assets/icon.png` | square, 48–4,096 px |

### Step 3: connect the server and verify the domain

1. Under **MCPs**, select the server and choose **Connect**.
2. **MCP Server URL**: `https://icanrunashow.com/api/mcp`. **Authentication**: OAuth, with dynamic client registration, which the ZIP's `.mcp.json` already declares (`extensions["com.openai"].auth`, step 1), so the portal should show it chosen. If it doesn't, choose it. Leave any client ID and secret empty: the server registers ChatGPT itself and has no secret to give.
3. **Domain verification.** Copy the token the portal shows. In Vercel → the project → Settings → Environment Variables, add `OPENAI_APPS_CHALLENGE` with the token as its value, for Production, and redeploy. Check that the address returns the token and nothing else:

   ```
   curl -s https://icanrunashow.com/.well-known/openai-apps-challenge
   ```

   Then choose **Verify Domain**. Leave the variable set for as long as the plugin is listed: submission fails if the check stops passing.
4. **Connect** and sign in with the reviewer account. On the app's consent page, leave all seven permissions ticked. The server lists only the tools a connection was granted, so a scan made with fewer permissions misses tools and they are never reviewed.
5. Wait for the tool scan. It reads each tool's name, title, description, input and output schemas, `securitySchemes`, annotations and the server's instructions. Review **Issues**, fix anything on the server, deploy, then **Rescan**. The server accepts browser requests from `https://platform.openai.com`, where the portal runs. If the connection still fails with `403 invalid_origin`, the portal sent some other `Origin` header; see [Known gaps](#known-gaps-and-risks).

### Step 4: review information

Under **Metadata & Skills → Review information**:

| Field | Value |
| --- | --- |
| Reviewer login URL | `https://icanrunashow.com` |
| Username and password | The reviewer account from section 1. Portal only |
| Sign-in steps | Open the address, choose Sign in, enter the username and password. No codes or second factor |
| Test cases | Imported from the ZIP: five positive, three negative, as in ASSISTANT-LISTINGS.md. Read-only in the portal |
| Demo video | A recording, viewable by reviewers, of connecting, choosing permissions on the consent page, and running the five positive test cases in ChatGPT on desktop and on the phone app. Use the reviewer account's sample data only |
| Commerce | None (from the ZIP): "Does not sell products or take payments." |
| Release notes | From the ZIP |
| Countries | Leave unset for every country, or list them |

If the portal asks for a justification for each tool's annotations, use the **Why** column in [Tools and annotations](#tools-and-annotations).

### Step 5: submit, then publish

1. Select the draft, choose **Submit for review**, and read each policy attestation before confirming it. Only one review can be open at a time; cancel it to replace the package.
2. Feedback comes by email. To disagree with a finding, reply with your reasons. There is no expedited review.
3. Once approved, choose **Publish plugin**: publishing is not automatic. People then find it by its exact name or a direct link.
4. Email press@openai.com before announcing it.

### Updating it later

- Changing the listing, the skill or the icon: raise `version` in both plugin manifests (the tests require them equal), run `npm run plugin:openai`, and upload the new ZIP to the same plugin. It is reviewed again; publish it when approved.
- Changing tools: deploy the server. OpenAI rescans daily, or choose **Rescan**. A changed tool keeps its old definition live until the change passes review, so the server should keep accepting the old arguments meanwhile. A removed tool disappears at once.

### Codex without the directory

Anyone can install the plugin in Codex from this repository: `codex plugin marketplace add taylordrew4u2/showrunner-icanrunashow`, then install `icanrunashow` from that marketplace.

## 3. Claude: Anthropic's directory

Anthropic asks for two submissions from the same organization: the server as an MCP connector, and the plugin bundle whose `.mcp.json` points at the same address. Paired, people see one set of tools rather than two. Both go through [claude.ai/directory/manage](https://claude.ai/directory/manage). Don't open a pull request to `anthropics/claude-plugins-official`: it takes no submissions.

### Prerequisites

- A paid Claude plan (Pro, Max, Ultra, Team or Enterprise). On Team or Enterprise an Owner submits, or someone with a role that has the Directory permission.
- For the plugin: your GitHub account connected on claude.ai with push access to `taylordrew4u2/Showrunner-ICanRunAShow`. The repository can be private during review if the Claude GitHub App is installed, but it must be public before the plugin is published.
- The plugin directory reads the default branch, so merge this work to `main` first, or name the branch in the Source step.

### A. The connector

**Submit new → MCP connector**, then each step:

| Step | What to enter |
| --- | --- |
| Connection | `https://icanrunashow.com/api/mcp`. When the portal signs in, use the reviewer account and leave all seven permissions ticked on the app's consent page: the server lists only the tools a connection was granted, so with any unticked, tools will be missing from the Tools step |
| Tools | Synced from the server. Check that every tool in the table there is listed, each with a title and grouped as read-only or write; see [Tools and annotations](#tools-and-annotations) |
| Listing | Name: I Can Run A Show (100). One-liner and description: from ASSISTANT-LISTINGS.md (200 and 2,000). Categories: Productivity, Business (one to five). Documentation: `https://icanrunashow.com/guides/ai-assistants.html`. Privacy policy: `https://icanrunashow.com/privacy.html`. Support: `skatematesnyc@gmail.com`. Icon: upload `plugins/icanrunashow/assets/icon.png`. Slug: `i-can-run-a-show`, permanent once published |
| Use cases | The five primary use cases and "What users need before connecting" from ASSISTANT-LISTINGS.md. Reads and writes: both |
| Company | Your name or company, `https://icanrunashow.com`, and the contact for review updates |
| Authentication | Always required. OAuth. Leave the client ID and secret empty: the server registers Claude by dynamic client registration |
| Data handling | Your own API; no personal health data; no sponsored content. Details in ASSISTANT-LISTINGS.md under Data handling |
| Test & launch | Confirm you ran every tool (section 1, step 5) |
| Compliance | Seven acknowledgements. Read each before ticking it |

After you submit, Anthropic scans the connector and lists it as Community. It may move it to Verified review, in which case a reviewer emails asking for test access: send the reviewer account then, by the channel they give. Escalations: mcp-review@anthropic.com.

### B. The plugin bundle

**Submit new → Plugin bundle**:

| Step | What to enter |
| --- | --- |
| Source | Repository `taylordrew4u2/Showrunner-ICanRunAShow`; plugin path `plugins/icanrunashow`; branch `main` unless you name another |
| Validate | Run it. Fix anything marked Blocking and validate again; results are per commit |
| Listing details | Read from `.claude-plugin/plugin.json` and `plugins/icanrunashow/README.md` |
| Data handling | Reads and stores personal data: yes, the producer's shows and the contact details of people they work with. Sent anywhere but the declared connector: no. Retention: as the privacy policy says. Intended for under-18s: no |
| Compliance | Contact email `skatematesnyc@gmail.com`, and four acknowledgements to read |
| Review & submit | Updates: GitHub push webhook (needs repository admin) or scheduled check. Leave "Auto-publish passing versions" off until the first version is live |

Each version gets validation and a security scan, and a person reviews a new listing before it goes live. Choose **Publish** once a version passes.

### Updating it later

Raise `version` in both plugin manifests and push. The directory scans each commit on the tracked branch; the last published version keeps serving if a new one fails. Listing edits other than tools go through the portal and are reviewed; a new display name means a new review, and the slug never changes. Change tools by deploying the server.

## Tools and annotations

What every tool is marked as, and why: the portals read the marks from the server, and OpenAI may ask for a one-line justification of each. Every tool needs `shows:read` as well as the permission listed. "Destructive" is yes for every write that overwrites or removes something, even one that can be undone: OpenAI allows "no" only for a purely additive write. "Open world" is false wherever a tool stays inside the producer's own private account. Each tool's title is sent both as its `title` and as `annotations.title`, which clients on older protocol versions read instead.

| Tool | Permission | Read-only | Destructive | Idempotent | Open world | Why |
| --- | --- | --- | --- | --- | --- | --- |
| `list_shows` | `shows:read` | Yes | No | Yes | No | Lists the account's own shows and changes nothing. |
| `get_show` | `shows:read` | Yes | No | Yes | No | Reads one show and changes nothing. |
| `search` | `shows:read` | Yes | No | Yes | No | Searches the account's own shows and Rolodex and changes nothing. |
| `fetch` | `shows:read` | Yes | No | Yes | No | Reads one search result and changes nothing. |
| `create_show` | `shows:write` | No | No | No | No | Adds a new show; nothing existing is changed. Calling it twice makes two shows. |
| `update_show` | `shows:write` | No | Yes | Yes | No | Overwrites show details with the values given. |
| `duplicate_show` | `shows:write` | No | No | No | No | Adds a copy; the original is untouched. Calling it twice makes two copies. |
| `add_performer` | `shows:write` | No | No | No | No | Adds a booking (and files a new name in the Rolodex); nothing is removed. |
| `update_performer` | `shows:write` | No | Yes | Yes | No | Overwrites a booked person's details on the show, and with `rolodex:write` their Rolodex entry too. |
| `remove_performer` | `shows:write` | No | Yes | Yes | No | Takes a booking off a show. Needs `confirm: true`. |
| `move_performer` | `shows:write` | No | Yes | No | No | Overwrites the lineup's order. Nobody is removed and it can be moved back, but only a purely additive write is non-destructive. Each call moves again. |
| `set_surprise_guest` | `shows:write` | No | Yes | Yes | No | Overwrites one performer's surprise-guest mark with the value given. It can be set back, but the mark that was there is replaced. |
| `add_cue` | `shows:write` | No | No | No | No | Adds a cue; nothing is removed. |
| `update_cue` | `shows:write` | No | Yes | Yes | No | Overwrites a cue's details. |
| `remove_cue` | `shows:write` | No | Yes | Yes | No | Removes a cue. Needs `confirm: true`. |
| `move_cue` | `shows:write` | No | Yes | No | No | Overwrites the running order. No cue is removed and it can be moved back, but only a purely additive write is non-destructive. Each call moves again. |
| `update_recap` | `shows:write` | No | Yes | Yes | No | Overwrites the recap's figures and notes. |
| `add_staff` | `shows:write` | No | No | No | No | Adds a crew member; nothing is removed. |
| `update_staff` | `shows:write` | No | Yes | Yes | No | Overwrites a crew member's details. |
| `remove_staff` | `shows:write` | No | Yes | Yes | No | Removes a crew member. Needs `confirm: true`. |
| `add_vendor` | `shows:write` | No | No | No | No | Adds a vendor; nothing is removed. |
| `update_vendor` | `shows:write` | No | Yes | Yes | No | Overwrites a vendor's details. |
| `remove_vendor` | `shows:write` | No | Yes | Yes | No | Removes a vendor. Needs `confirm: true`. |
| `delete_show` | `shows:delete` | No | Yes | Yes | No | Moves a show to the app's Trash, where it can be restored. Treated as deletion all the same. Needs `confirm: true`. |
| `list_rolodex` | `rolodex:read` | Yes | No | Yes | No | Lists the account's own Rolodex and changes nothing. |
| `get_comic` | `rolodex:read` | Yes | No | Yes | No | Reads one Rolodex entry and changes nothing. |
| `add_comic` | `rolodex:write` | No | No | No | No | Adds a Rolodex entry; nothing existing is changed. |
| `update_comic` | `rolodex:write` | No | Yes | Yes | No | Overwrites a Rolodex entry, and that person's bookings with it. |
| `list_contracts` | `contracts:read` | Yes | No | Yes | No | Lists the account's contract templates and changes nothing. |
| `list_signature_requests` | `contracts:read` | Yes | No | Yes | No | Lists the links already sent and what came back, and changes nothing. |
| `send_profile_link` | `links:send` | No | Yes | No | Yes | Makes a link that someone outside the account can open and answer; it can be withdrawn but not unsent. Each call makes a new link. Needs `confirm: true`. Contacts nobody. |
| `send_contract` | `links:send` | No | Yes | No | Yes | Makes a signing link that someone outside the account can open and sign; it can be withdrawn but not unsent. Each call makes a new link. Needs `confirm: true`. Contacts nobody. |

## Known gaps and risks

- **No OpenID Connect.** The server offers no `openid` or `email` scope and no UserInfo endpoint, and the app doesn't collect email addresses. OpenAI uses these only to let ChatGPT Enterprise admins limit a plugin to their company's email domain, and no submission check requires them. `/.well-known/openid-configuration` answers 404, which tells ChatGPT there is no OIDC. Add it only if OpenAI's review asks.
- **Browser origins.** `/api/mcp` and the public OAuth routes refuse requests whose `Origin` header is not the app, `chatgpt.com`, `chat.openai.com`, `platform.openai.com` (OpenAI's portal, which connects and scans from the browser), `claude.ai` or `claude.com`; requests with no `Origin` are fine. Anthropic's portal doesn't document sending one. If a portal's connect or scan step fails with `403 invalid_origin`, add that origin to `ASSISTANT_ORIGINS` in `api/_lib/chatgptAuth.ts`.
- **Rate limits.** Registration allows 30 requests an hour and the token endpoint 300 an hour per client address. Claude and ChatGPT reach the server from shared addresses (Anthropic's are 160.79.104.0/21), so a busy review or launch may need these raised. Don't block those addresses in Vercel's firewall.
- **Annotation justifications.** OpenAI's guidelines say they are no longer required, and its submission-errors page still lists them. The **Why** column covers both.
- **Screenshots.** Neither directory asks for screenshots of a connector without its own interface, so none were made.
- **The demo video and reviewer account** can only come from you; see sections 1 and 2.

## Sources

OpenAI, read November 16, 2026:

- [Build plugins](https://developers.openai.com/plugins/build/plugins) and [Skills](https://developers.openai.com/plugins/build/skills)
- [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission) and [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors)
- [App review](https://developers.openai.com/plugins/deploy/app-review) and [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
- [Authentication](https://developers.openai.com/plugins/build/auth), [MCP server](https://developers.openai.com/plugins/build/mcp-server) and [Reference](https://developers.openai.com/plugins/reference)
- [Submitting a Claude plugin](https://developers.openai.com/plugins/guides/submit-claude-plugin)
- [openai/plugins](https://github.com/openai/plugins), for example manifests

Anthropic, read November 16, 2026:

- [Publish to the directory](https://claude.com/docs/directory/publish)
- [Submit a connector](https://claude.com/docs/connectors/building/submission), [Review criteria](https://claude.com/docs/connectors/building/review-criteria), [Authentication](https://claude.com/docs/connectors/building/authentication) and [Testing](https://claude.com/docs/connectors/building/testing)
- [Build a plugin](https://claude.com/docs/plugins/build), [Pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist) and [Submit a plugin](https://claude.com/docs/plugins/submit)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) and [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)
- [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)

The protocol: [MCP 2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) and [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
