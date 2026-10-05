# Features

The full feature list. The [README](../README.md) has the short version.

## Personalization

- First-run onboarding: name your brand and pick the kinds of shows you produce (comedy, drag, music, variety, …)
- Show-type-aware wording: the Rolodex adapts to what you book (Comic Rolodex, Queen Rolodex, Artist Rolodex, …), with an editable override in Settings
- Light and Dark color schemes; the choice persists across visits and applies app-wide, including the public viewer page
- Per-show customizable sections: hide the sections you don't use
- A utility look (neutral greys, flat hairline panels, small corners, tabular figures) so the app reads as a tool at the side of a stage rather than a landing page

## Show building

- Multiple shows with status tracking (upcoming, in-progress, completed, cancelled)
- A show opens on its performers: the lineup comes first, with the running order beside it on a laptop and below it on a phone
- Per-show lineup with performer profiles: headshot, social media, email, credits, walk-on track, and video link
- A flyer on every show: upload, view full size, download, replace or remove. Stored encrypted like headshots, and never removed by the storage sweep while a show uses it
- Headshots are resized in the browser and stored encrypted in the media store; the photo becomes the face on that performer's Run Show button
- Clickable contacts: social handles link straight to the profile (bare handles resolve to Instagram); one tap to email a performer
- "Email all performers" opens your mail app with the lineup BCC'd and a pre-filled confirmation
- Global performer Rolodex: save a performer once, reuse across shows; edits sync to all matching performers
- Vendors, staff, host, expenses, and per-section deadlines on each show
- Post copy: the show's details, host, bill and everyone's handles composed into a caption and copied to the clipboard (nothing is posted for you)

## Schedule import

- Import a schedule from a photo, a PDF, or pasted text, all processed on the device: PDF.js for PDFs, Tesseract.js OCR for photos, then a line parser that picks out times, performers and durations
- Nothing leaves the phone, and there is no key or account to add. A photo of a messy run sheet yields what OCR can read off it

## Run Show

- Full-screen live mode: a clock, a soundboard, and the lineup. The clock and the sound are independent, so nothing you press changes the time
- One button per performer, with their headshot on it. Press it to fade their song in, press again to fade it out; pressing another button hands over between tracks
- Separate banks for show tracks (cue uploads) and for the DJ list, so a DJ song is never one press away from a walk-on
- Per-cue countdown, drift indicator, keyboard navigation, and per-cue duration adjustment
- Public read-only viewer URL with live on-stage / up-next state

## Paperwork

- File already-signed PDFs under Venue contracts or Producer contracts and download them anytime from the Contracts page
- Upload a contract, send it to anyone in the Rolodex, and watch the list go from waiting to signed
- The signer needs no account: they open a link, read the PDF, type their name and agree. The server never holds a key that could read any of it
- Every signature records the typed name, the timestamp, and a SHA-256 of the exact bytes shown, so the copy on file can be shown to be the copy agreed to
- A day-of cancellation rule the signer must acknowledge, recorded with the signature

## Running it from the stage

- The operator is usually on the bill too. A Bluetooth clicker paired to the laptop starts and stops the music from anywhere in the room, with no network involved
- The app learns the button rather than guessing: clickers disagree about what they send, so Settings listens once and remembers. Volume keys are refused with an explanation rather than accepted and silently broken
- Real fullscreen and a screen wake lock for the length of the show

## Platform

- Installable PWA with an offline shell
- Client-side AES encryption with PBKDF2-derived keys; the database only ever stores ciphertext and is reached through server API routes
- PDF runsheet export
- Drag-and-drop file uploads with MIME validation
- Native iOS wrapper via Capacitor (see [IOS.md](IOS.md))
