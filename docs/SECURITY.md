# Security, Accessibility, Limitations and Roadmap

## Security model

- Passwords are never stored. A PBKDF2-derived key is used for encryption, and a separate hash is used for authentication
- All show data and settings are encrypted with AES (crypto-js) in the browser before being written to Turso
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
- Photo import is OCR plus a line parser. A clean printed run sheet imports well; a handwritten or crooked one may need rows fixed by hand
- The OCR worker and language data load from a CDN at runtime, so import-from-photo needs a connection even though the rest of the app works offline
- The stage remote is any Bluetooth clicker that pairs as a keyboard. A phone cannot serve as one from the web app: no browser can advertise as a Bluetooth peripheral, and iOS Safari has no Web Bluetooth
- Some failure states surface as console errors rather than user-facing messages
- iPhone HEIC headshots won't decode outside Safari and need converting to JPEG/PNG first

## Roadmap

- Migrate the encryption KDF to native WebCrypto/Argon2 with a per-user random salt and OWASP-grade iterations
- Component-level tests for the editing surfaces
- Full accessibility audit (ARIA coverage, color contrast, screen-reader testing)
- Finish the phone pass: pull-to-reveal search, and a large title that collapses into the top bar on scroll
- A real WebKit project in the end-to-end suite (the phone project currently emulates an iPhone in Chromium)
- A native iOS build that lets the phone itself act as the stage remote over Bluetooth
- Bundle the OCR worker so schedule import works offline like the rest of the app
