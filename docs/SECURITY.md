# Security, Accessibility, Limitations and Roadmap

## Security model

- Passwords are never stored or sent. A PBKDF2-derived key is used for encryption. Authentication uses a separate credential: PBKDF2-SHA256 in WebCrypto, 210k iterations, salted per account and labelled apart from the encryption key, so it is never a cheaper way to the password than the ciphertext is
- Accounts made before that credential held a single SHA-256 of the password. Each moves over at its next sign-in from a current build: the old hash is sent once, checked, and replaced. From then on it opens nothing, and a device still holding it is sent back to sign-in with its unsaved work kept
- New accounts need a password of at least 8 characters
- All show data and settings are encrypted with AES (crypto-js) in the browser before being written to Turso
- Connecting an AI assistant (Claude or ChatGPT) is an explicit exception to browser-only decryption: consent sends derived account encryption keys to the connector, which decrypts what an authorized assistant request needs while serving it. The password is never sent. The keys can unlock the whole account; the permissions the producer ticks (shows, Trash, Rolodex, contracts, links) are enforced by the server on each tool call, not by the encryption. Keys are sealed at rest under keys derived from high-entropy authorization codes/tokens, and tokens are stored only as hashes, which the seal key is not, so a copy of the database alone cannot unseal them; possession of a valid connector token is sensitive access. Accepted callbacks are ChatGPT's two exact callback paths, Claude's exact callback, and loopback addresses for native clients such as Claude Code, all with PKCE S256. Each connection can be disconnected on its own, or all at once. See [AI-ASSISTANTS.md](AI-ASSISTANTS.md) before enabling one
- Co-producer links are a second, explicit exception to browser-only decryption. Making one sends the account's derived encryption keys to the server, which seals them under a key derived from the link's random 256-bit token (HKDF with a label of its own, bound to the link's row) and keeps the token only as a hash, so a copy of the database alone cannot unseal them. While serving a co-producer, the server decrypts the account, removes link secrets (signing and details link tokens and keys, viewer tokens and audio keys), checks every value against a strict schema, and returns a read-only copy; backup history, billing and AI connections are never served. The co-producer's app runs on its own origin (showrunner-theta.vercel.app, a different site from icanrunashow.com), so it shares no storage with either producer's account; that address opens co-producer links and nothing else, never the sign-in or a stored session. A co-producer cannot write to the account: every change, share and download they attempt is stored as a request encrypted under the account key, and only the owner's app applies it, through the owner's normal saves, after validating it and showing the owner everything it would change. Links last 30 days and can be withdrawn one at a time or all at once. Limits: the server enforces that changes and link shares need approval; downloads, copying and printing are held back by the app, but anything shown to a co-producer can be screenshotted, copied or saved from their screen or their browser's tools; withdrawing a link stops future access but cannot recall what was already seen; a link the owner approved for a co-producer to share (a signing, details or viewer link) keeps working, and anything sent through it is filed in the account, until the owner withdraws that link too; a forwarded co-producer link works for whoever holds it until it is withdrawn or expires
- The database is reached only through server-side API routes; the Turso credential is a server environment variable and never ships in the client bundle
- The stored auth credential is a per-user salted, slow PBKDF2 hash (the client hash is never stored verbatim), compared in constant time, with legacy rows upgraded transparently on next login
- Authentication is rate-limited per account; public upsert routes cap payload size
- Credentials load from environment variables with no fallback values in source
- Signing and live-viewer links carry their decryption key in the URL fragment, which browsers never transmit to the server
- Schedule import runs entirely on the device, so a photo of a run sheet is never uploaded

## Accessibility

- Form inputs have associated labels; icon-only buttons and dropzones have ARIA labels
- Minimum 44px touch targets on touch devices
- `:focus-visible` rings on all interactive controls, so they appear for keyboard users only
- Show cards are containers, not controls: a real overlay `<button>` covers each one and leads its tab order, so nothing is a control nested inside a control
- Form fields are at least 16px on coarse-pointer devices, preventing iOS auto-zoom
- Run Show is fully keyboard-driveable (asserted in the end-to-end suite)

A full keyboard, ARIA and color-contrast audit is still to do.

## Known limitations

- The encryption KDF uses a static (non-per-user) salt and 100k SHA-256 iterations, capped by pure-JS crypto-js, rather than the OWASP-recommended 600k. Improving both needs a move to native WebCrypto or Argon2
- No password recovery: losing the password means losing access to the data. This is the cost of client-side encryption
- An account nobody has signed in to since the per-account credential shipped still opens with the old SHA-256 hash, and a session saved before then keeps sending it, until someone signs in to that account from a current build. Accounts made under the old 3-character minimum keep their short passwords
- Photo import is OCR plus a line parser. A clean printed run sheet imports well; a handwritten or crooked one may need rows fixed by hand
- The OCR worker and language data load from a CDN at runtime, so import-from-photo needs a connection even though the rest of the app works offline
- The stage remote is any Bluetooth clicker that pairs as a keyboard. A phone cannot serve as one from the web app: no browser can advertise as a Bluetooth peripheral, and iOS Safari has no Web Bluetooth
- Some failure states surface as console errors rather than user-facing messages
- iPhone HEIC headshots won't decode outside Safari and need converting to JPEG/PNG first
- Co-producer links, beyond the limits above: the keys are in server memory for the length of each co-producer request (sealed at rest); the owner sees when a link was first opened and last used, not by whom; the link's token is stripped from the address bar before the app starts but stays in the browser's history; signatures and details replies reach a co-producer only once the owner's app has filed them; a phone (`tel:`) link needs no approval, since it hands nothing from the account to anyone; Run Show on a co-producer's device never drives the room's viewer screen or its audio; and a browser that installed the app before co-producer links shipped may open its old app at `/coproduce` until it updates, which a reload after the update prompt fixes

## Roadmap

- Migrate the encryption KDF to native WebCrypto/Argon2 with a per-user random salt and OWASP-grade iterations
- Component-level tests for the editing surfaces
- Full accessibility audit (ARIA coverage, color contrast, screen-reader testing)
- Finish the phone pass: pull-to-reveal search, and a large title that collapses into the top bar on scroll
- A real WebKit project in the end-to-end suite (the phone project currently emulates an iPhone in Chromium)
- A native iOS build that lets the phone itself act as the stage remote over Bluetooth
- Bundle the OCR worker so schedule import works offline like the rest of the app
