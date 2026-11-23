# Features

The full feature list. The [README](../README.md) has the short version.

## Personalization

- First-run onboarding: name your brand and pick the kinds of shows you produce (comedy, drag, music, variety, …)
- Show-type-aware wording: the Rolodex adapts to what you book (Comic Rolodex, Queen Rolodex, Artist Rolodex, …), with an editable override in Settings
- Light and Dark color schemes; the choice persists across visits and applies app-wide, including the public viewer page
- Per-show customizable sections: hide the sections you don't use
- A utility look (neutral greys, flat hairline panels, small corners, tabular figures) so the app reads as a tool at the side of a stage rather than a landing page

## Getting started

- A sample show one tap from the empty Shows page: a timed running order from doors to the headliner, ready for Run Show, with nobody made up added to the Rolodex
- A features and pricing page at [/tour/](https://icanrunashow.com/tour/), static so it costs the app bundle nothing
- A guided tour inside the app, on the sample show: a card docked at the bottom of the screen walks through every part of the app in order (the Shows list, a show's lineup, hosts, running order, notes, sections and flyer, Run Show's clock and soundboard, the viewer link, the Rolodex, Music, contracts, the Season report, expenses and the email list, Settings, backups, AI assistants and co-producers), takes you to the real page for each step and outlines the real control. It is not a dialog: the page stays usable around it, "Jump to the control" moves the keyboard to the outlined control, and the card folds down to one line. The tour only navigates. It adds the sample show once, after asking, and never sends, publishes, makes a link, uploads or downloads anything
- The tour is offered, never forced: a new account sees one dismissible line on the Shows list. It can be ended at any step, picked up later where it stopped, or started again, from More → Help & setup
- Help & setup, the last row on More: eleven short step-by-step wizards opened only when wanted (your first show, the Rolodex, contracts and signing, the viewer link and Run Show, music and walk-ons, flyer and Post copy, Claude and ChatGPT, co-producers, backups and recovery, making the workspace yours, money and the season). Each step's button opens the real page with the same card, and a step reads as done from what the account actually holds; steps with nothing to read have a tick box. The sample show never counts, and nor does anyone filed in the Rolodex only from its lineup, even once the sample show is deleted and gone from Recently deleted: booking them on a show of your own, or editing their entry in the Rolodex, makes them count. Steps the free plan holds back show the usual Producer note and are not counted against the wizard
- Where the tour stopped, what was ticked and whether the offer was dismissed are kept on the device, per account. Nothing about them is saved to the account or included in a backup
- In co-producer view there is no tour and no offer, and Help & setup is read-only: it lists only the wizards for pages a co-producer can use, and their buttons just open those pages
- The website lineup feed has no wizard: it is switched on by the operator through server settings (see [WEBSITE-LINEUPS.md](WEBSITE-LINEUPS.md)) and has no screen in the app

## Season report

- Every show added up for this year or all time: shows run, audience and the average night, performers booked, net from recaps, and brand spending
- Your regulars and your rooms (the most-booked performers and venues) and the biggest night
- A venue pitch composed from those numbers and copied to the clipboard (nothing is sent), leaving out anything that was never recorded

## Show building

- Multiple shows with status tracking (upcoming, in-progress, completed, cancelled)
- A show opens on its performers: the lineup comes first, with the running order beside it on a laptop and below it on a phone
- Per-show lineup with performer profiles: headshot, social media, email, credits, walk-on track, and video link
- A flyer on every show: upload, view full size, download, replace or remove. Stored encrypted like headshots, and never removed by the storage sweep while a show uses it
- Headshots are resized in the browser and stored encrypted in the media store; the photo becomes the face on that performer's Run Show button
- Clickable contacts: social handles link straight to the profile (bare handles resolve to Instagram); one tap to email a performer
- "Email all performers" opens your mail app with the lineup BCC'd and a pre-filled confirmation
- Global performer Rolodex: save a performer once, reuse across shows; edits sync to all matching performers
- Vendors, staff, expenses, and per-section deadlines on each show
- Up to two hosts on a show, each with a social handle. Pick a host from the Rolodex and their handle comes with them and stays in step with their entry; type a name and you type the handle beside it, and when the name is someone in the Rolodex with no handle yet, leaving the field saves it to their entry. A show saved with one host keeps it as the first host, with nothing to migrate
- The hosts and their handles appear wherever the host does: the show page and its card, Post copy, the public viewer page, the printed runsheet, the running-order tools, the website lineup feed, and what assistants and co-producers see
- A recap once the night is over: attendance, ticket and merch sales, other costs (door split, performer pay), and the profit or loss after the show's vendors, on screen and on the printed runsheet
- Post copy: the show's details, the host or hosts, the bill and everyone's handles, hosts' included, composed into a caption and copied to the clipboard (nothing is posted for you)

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

## Co-producers

- Co-producers: give another producer a link to see everything in your account. Their changes, and any links they want to share, come to you under Requests, showing what's there now and what they asked for, and only go in if you approve them. Their downloads, copying and printing wait for your approval in the app too, though anything they can see can still be saved by someone determined. Withdraw a link any time in Settings, along with any links you approved for them to share.

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
