# Connect shows to ChatGPT

I Can Run A Show exposes an authenticated Model Context Protocol (MCP) server at `/api/mcp`. This is a modern ChatGPT custom app connection, rather than the retired ChatGPT plugin manifest format. It supports viewing and managing shows through tool calls; it does not add an embedded chat widget or publish an app listing automatically.

## Connect a deployed app

1. Deploy the web app and its Vercel API with the normal Turso configuration. Set `APP_URL` to the canonical HTTPS origin, for example `https://icanrunashow.com`. The Vite development server alone does not run the API.
2. In the app, open **Settings → ChatGPT → Connect your app** and copy the connector URL ending in `/api/mcp`.
3. In ChatGPT Settings, enable developer mode and create a custom app/connector using that URL and **OAuth** authentication. The exact labels and availability depend on your ChatGPT plan and workspace policy. Dynamic registration supplies the public client ID; no shared API key or client secret is needed.
4. Connect it, sign in to your show account on the app's authorization page, and review the access request. Creating/editing shows can be unchecked for read-only access. Nothing is granted until **Allow access** is pressed.
5. Add the connected app to a ChatGPT conversation and ask, for example, “List my upcoming shows,” “Create a show called Friday Comedy for December 4, 2026 at 8pm,” or “Mark Friday Comedy completed.” Ask ChatGPT to confirm the local event date/time if it is ambiguous.

To revoke future access, open **Settings → ChatGPT → Manage connections → Disconnect ChatGPT**. This revokes all connections for that show account, including their refresh tokens. It does not remove information already included in ChatGPT conversations. Connections expire after 30 days and must then be authorized again.

The deployed HTTPS endpoint and a real ChatGPT account connection require a separate live check after deployment. Passing the local suites does not establish deployment, app directory approval, or ChatGPT workspace availability.

## Tools

| Tool | Behavior |
| --- | --- |
| `list_shows` | Lists only the connected account's shows. Optional status filter, `limit` and `cursor`; follow `next_cursor` even when a filtered page is empty. |
| `get_show` | Reads show details, performer/artist names and the running order. Returns a revision for subsequent edits. |
| `create_show` | Creates a show with empty lineup and running order. Supports name, local date/time, venue, location, status and HTTPS ticket link. |
| `update_show` | Changes those show details. Requires `id`, `expected_revision` from `get_show`, and a `patch`. A stale revision refuses the write instead of overwriting another device's work. |

Tools do not delete shows, edit lineups or running orders, manage accounts/billing, expose private planning notes, contact details, contracts, stored media or viewer keys. `completed` shows leave Upcoming and remain in History. Read-only connections advertise only the read tools and cannot execute writes even if a client calls them directly.

Reload an already-open browser app to see changes made through ChatGPT. Its existing save-conflict protection prevents stale browser edits from silently replacing a newer connector edit.

## Consent and encryption

Normal browser use decrypts data on the device. This optional connection changes that trust boundary: approval delegates the account's derived encryption keys so the connector can decrypt show records for ChatGPT requests and encrypt edits before writing them back. The account password is never delegated. Tool results expose a small allowlist of show fields, rather than serializing complete records.

The delegated keys can cryptographically unlock other data encrypted under the same account keys, even though connector tools do not expose that data. Enabling the connection therefore trusts the app's connector service with those keys as well as trusting ChatGPT with returned show information. Do not enable it if you require keys never to leave the device.

The database stores tokens as hashes and delegated keys as AES-GCM ciphertext, wrapped under the corresponding random authorization code/access/refresh token. A database copy alone does not contain the wrapping credentials. The service decrypts keys during authorized requests; this is not protection against compromise of the running connector or a stolen valid token. Responses are marked `no-store`, and keys/tokens must not be logged. Revocation disables the connection's tokens; account deletion removes its grants and tokens.

## Protocol and validation

- Stateless Streamable HTTP JSON-RPC at `/api/mcp`, with authenticated `initialize`, `ping`, `tools/list` and `tools/call`.
- OAuth authorization server metadata at `/.well-known/oauth-authorization-server` and protected-resource metadata at `/.well-known/oauth-protected-resource` (also the `/api/mcp` suffix variant).
- Public-client dynamic registration, exact registered ChatGPT HTTPS callbacks, authorization-code flow with PKCE S256, MCP resource audience checks, one-use short-lived codes, one-hour access tokens and rotating refresh tokens. Refresh-token replay revokes that connection.
- Existing authenticated app credentials are used only for consent and managing/revoking connections; they are not sent to ChatGPT.
- Show writes use the same encrypted compare-and-swap/backups path as the browser.

Run `npm test`, `npm run lint` and `npm run build` for server/utility checks. With Chromium installed, `PW_CHROMIUM_PATH=/usr/bin/chromium npm run e2e -- e2e/chatgpt.spec.ts --workers=2` exercises the consent and disconnect UI with the hermetic API fixture. Server tests use isolated local databases and exercise the actual schema, token lifecycle and encrypted writes.

References: [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples), [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
