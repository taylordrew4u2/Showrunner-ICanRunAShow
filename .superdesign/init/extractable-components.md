# Extractable component menu

Candidates only; no remote DraftComponents have been created. Extract state/navigation props only; data content remains page content.

## AppNavigation
- Source: `src/App.tsx`
- Category: layout
- Description: Five stable destinations with brand, desktop popover and mobile bottom bar.
- Extractable props: activeItem, navigationOpen
- Hardcoded: BrandMark, Shows/Rolodex/Music/More/Settings labels, icons, classes

## PageHeader
- Source: `src/components/PageHeader.tsx`
- Category: layout
- Description: Consistent title, optional back and actions.
- Extractable props: showBack, showActions
- Hardcoded: Typography, spacing, back icon, classes; keep each page title in content

## SyncStatus
- Source: `src/components/SyncStatus.tsx`
- Category: layout
- Description: Persistent saving/saved/retry/offline/blocked status.
- Extractable props: syncState, hasLocalCopy
- Hardcoded: Status icon vocabulary, labels and styles

## ShowCard
- Source: `src/components/ShowCard.tsx`
- Category: basic
- Description: Show entry with date, title, status and actions.
- Extractable props: isActive, showActions
- Hardcoded: Layout, status visual language, action icons

## ButtonVariants
- Source: `src/App.css`
- Category: basic
- Description: Primary, secondary, danger and small native-button styles.
- Extractable props: isDisabled, isActive
- Hardcoded: Colors, radii, typography and class recipes

## MoreMenu
- Source: `src/components/MoreMenu.tsx`
- Category: basic
- Description: Accessible action overflow.
- Extractable props: isOpen
- Hardcoded: Menu layout, dots icon, CSS

## Modal
- Source: `src/components/Modal.tsx`
- Category: basic
- Description: Shared dismissible dialog shell.
- Extractable props: isOpen
- Hardcoded: Overlay, panel geometry and focus behavior

## SoundboardPad
- Source: `src/components/RunShow.tsx`
- Category: basic
- Description: Live music pad with label and playback/loading feedback.
- Extractable props: isPlaying, isLoading, isSelected
- Hardcoded: Pad visual treatment and icon language

## OnStagePicker
- Source: `src/components/OnStagePicker.tsx`
- Category: basic
- Description: Reusable performer/host picker.
- Extractable props: isOpen, activeItem
- Hardcoded: Field and picker styling, icon shapes
