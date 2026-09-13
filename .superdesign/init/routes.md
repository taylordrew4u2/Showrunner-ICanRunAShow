# Routes and destination mapping

No React Router or file-based routing. All normal destinations retain `/` and are selected with App `view` state. Public query routing precedence: view → profile → sign → authenticated app. URL fragments carry decryption keys. Prefix component paths below with `src/components/` except App.tsx (`src/App.tsx`).

| URL/state | Component | Layout and purpose |
|---|---|---|
| / | App.tsx → Login.tsx | Unauthenticated landing/sign-in; no signed-in shell |
| / (view=list) | ShowsDashboard.tsx + ShowCard.tsx / ShowsCalendar.tsx | Signed-in App shell; upcoming shows, attention tasks, filtered list/calendar |
| / (view=detail) | ShowDetail.tsx | Signed-in shell; selected show overview, people and planning sections |
| / (detail schedule section) | sections/ScheduleSection.tsx | Inside ShowDetail; choose lineup generation/template/import/manual builder, edit and reorder cues |
| / (detail live overlay) | RunShow.tsx | Full-screen modal console over ShowDetail; manual soundboard, independent timer and running order |
| / (view=music) | MusicLibrary.tsx | Signed-in shell and PageHeader; account-wide audio tracks |
| / (view=rolodex) | App.tsx + RolodexRow.tsx | Signed-in shell and PageHeader; contacts and profile drawer |
| / (view=settings) | Settings.tsx | Signed-in shell and PageHeader; saved app preferences, clicker pairing and recovery |
| / (view=more) | MorePage.tsx | Signed-in shell; secondary destinations |
| / (view=contracts) | Contracts.tsx | Signed-in shell; contract preparation and requests |
| / (view=expenses) | Expenses.tsx | Signed-in shell; expenses |
| / (view=emails) | App.tsx inline | Signed-in shell; email list |
| /?view=<token> | LiveViewer.tsx | Public read-only live viewer; no authenticated shell |
| /?profile=<token>#<key> | ProfilePage.tsx | Public performer details form; no authenticated shell |
| /?sign=<token>#<key> | SigningPage.tsx | Public contract signature form; no authenticated shell |

## Complete routing implementation
There is no independent router config. The complete App.tsx source is copied in layouts.md; this cross-reference avoids duplicating its 2,400-line shell. main.tsx is also in layouts.md.
