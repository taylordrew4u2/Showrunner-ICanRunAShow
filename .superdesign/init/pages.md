# Key page dependency trees

All resolvable local static/dynamic imports are traced recursively (including type and CSS imports); node_modules excluded. Within each tree, repeated files are marked “already expanded” so every dependency appears without exponential repetition. These are candidate files, not a bulk generation payload. Shared entry globals: src/main.tsx → src/fonts.css, src/index.css, src/App.tsx → src/App.css, then src/design.css. RunShow does not import its own CSS: include App.css RunShow rules and final design.css overrides. ScheduleSection inherits ShowDetail.css via its parent.

## Run Show live console
Entry: `src/components/RunShow.tsx`

```text
- src/types/index.ts
- src/utils/audioEngine.ts
  - src/utils/media.ts
  - src/utils/mediaStore.ts
    - src/utils/api.ts
    - src/utils/encryption.ts
    - src/utils/session-vault.ts
      - src/utils/encryption.ts (already expanded)
    - src/utils/media.ts (already expanded)
- src/utils/walkOnFallback.ts
  - src/types/index.ts (already expanded)
- src/utils/padColor.ts
- src/utils/liveView.ts
  - src/utils/api.ts (already expanded)
  - src/utils/session-vault.ts (already expanded)
  - src/utils/theme.ts
  - src/utils/viewerAudio.ts
    - src/utils/api.ts (already expanded)
    - src/utils/encryption.ts (already expanded)
    - src/utils/mediaStore.ts (already expanded)
    - src/utils/session-vault.ts (already expanded)
- src/utils/session-vault.ts (already expanded)
- src/utils/theme.ts (already expanded)
- src/utils/showTiming.ts
  - src/types/index.ts (already expanded)
- src/utils/soundboard.ts
  - src/types/index.ts (already expanded)
- src/utils/useMediaUrl.ts
  - src/utils/mediaStore.ts (already expanded)
- src/utils/mediaStore.ts (already expanded)
- src/utils/viewerAudio.ts (already expanded)
- src/utils/audioSettings.ts
- src/components/Icon.tsx
- src/components/useConfirm.tsx
  - src/components/Modal.tsx
    - src/components/Modal.css
  - src/components/useConfirm.css
- src/utils/stageRemote.ts
```

## Run of Show schedule editor
Entry: `src/components/sections/ScheduleSection.tsx`

```text
- src/types/index.ts
- src/utils/id.ts
- src/utils/media.ts
- src/utils/mediaStore.ts
  - src/utils/api.ts
  - src/utils/encryption.ts
  - src/utils/session-vault.ts
    - src/utils/encryption.ts (already expanded)
  - src/utils/media.ts (already expanded)
- src/components/TrimControls.tsx
  - src/utils/audioEngine.ts
    - src/utils/media.ts (already expanded)
    - src/utils/mediaStore.ts (already expanded)
  - src/utils/trim.ts
  - src/components/TrimControls.css
- src/components/Icon.tsx
- src/components/ShowTimeline.tsx
  - src/types/index.ts (already expanded)
  - src/utils/showTimeline.ts
    - src/types/index.ts (already expanded)
    - src/utils/showTiming.ts
      - src/types/index.ts (already expanded)
    - src/utils/elapsed.ts
      - src/types/index.ts (already expanded)
      - src/utils/showTiming.ts (already expanded)
  - src/utils/elapsed.ts (already expanded)
  - src/components/ShowTimeline.css
- src/utils/cuePerformer.ts
  - src/types/index.ts (already expanded)
- src/components/useConfirm.tsx
  - src/components/Modal.tsx
    - src/components/Modal.css
  - src/components/useConfirm.css
- src/utils/showTiming.ts (already expanded)
- src/utils/scheduleTemplates.ts
  - src/types/index.ts (already expanded)
  - src/utils/showTiming.ts (already expanded)
  - src/utils/elapsed.ts (already expanded)
- src/components/ScheduleTemplates.tsx
  - src/types/index.ts (already expanded)
  - src/utils/scheduleTemplates.ts (already expanded)
  - src/components/Modal.tsx (already expanded)
  - src/components/useConfirm.tsx (already expanded)
  - src/components/ScheduleTemplates.css
- src/components/ScheduleGenerator.tsx
  - src/types/index.ts (already expanded)
  - src/utils/generateSchedule.ts
    - src/utils/id.ts (already expanded)
    - src/utils/elapsed.ts (already expanded)
    - src/types/index.ts (already expanded)
  - src/components/Modal.tsx (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/components/ScheduleGenerator.css
- src/components/OnStagePicker.tsx
  - src/types/index.ts (already expanded)
- src/components/AIImportFlow.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/utils/aiExtractor.ts
    - src/types/index.ts (already expanded)
    - src/utils/id.ts (already expanded)
    - src/utils/api.ts (already expanded)
    - src/utils/showTiming.ts (already expanded)
  - src/utils/cuePerformer.ts (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/components/OnStagePicker.tsx (already expanded)
```

## Show overview
Entry: `src/components/ShowDetail.tsx`

```text
- src/types/index.ts
- src/utils/id.ts
- src/components/SceneList.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/components/SceneList.css
  - src/components/useConfirm.tsx
    - src/components/Modal.tsx
      - src/components/Modal.css
    - src/components/useConfirm.css
- src/components/Icon.tsx
- src/components/MoreMenu.tsx
  - src/components/MoreMenu.css
- src/components/sections/BasicInfoSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/readShowStart.ts
    - src/utils/showTimeline.ts
      - src/types/index.ts (already expanded)
      - src/utils/showTiming.ts
        - src/types/index.ts (already expanded)
      - src/utils/elapsed.ts
        - src/types/index.ts (already expanded)
        - src/utils/showTiming.ts (already expanded)
- src/components/sections/PerformersSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/utils/rolodex.ts
    - src/types/index.ts (already expanded)
    - src/utils/id.ts (already expanded)
  - src/utils/social.ts
  - src/utils/lineupTarget.ts
  - src/utils/performerReadiness.ts
    - src/utils/socialPost.ts
      - src/types/index.ts (already expanded)
    - src/utils/social.ts (already expanded)
    - src/types/index.ts (already expanded)
  - src/components/sections/PerformerProfile.tsx
    - src/types/index.ts (already expanded)
    - src/utils/imageResize.ts
    - src/utils/media.ts
    - src/utils/mediaStore.ts
      - src/utils/api.ts
      - src/utils/encryption.ts
      - src/utils/session-vault.ts
        - src/utils/encryption.ts (already expanded)
      - src/utils/media.ts (already expanded)
    - src/components/TrimControls.tsx
      - src/utils/audioEngine.ts
        - src/utils/media.ts (already expanded)
        - src/utils/mediaStore.ts (already expanded)
      - src/utils/trim.ts
      - src/components/TrimControls.css
    - src/utils/useMediaUrl.ts
      - src/utils/mediaStore.ts (already expanded)
    - src/utils/social.ts (already expanded)
    - src/utils/rolodex.ts (already expanded)
    - src/components/sections/PerformerProfile.css
    - src/components/useConfirm.tsx (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/utils/contracts.ts
    - src/utils/introductionCredits.ts
      - src/types/index.ts (already expanded)
    - src/types/index.ts (already expanded)
    - src/utils/api.ts (already expanded)
    - src/utils/encryption.ts (already expanded)
    - src/utils/mediaStore.ts (already expanded)
    - src/utils/rolodex.ts (already expanded)
    - src/utils/showDate.ts
    - src/utils/session-vault.ts (already expanded)
- src/components/sections/PerformerContracts.tsx
  - src/types/index.ts (already expanded)
  - src/utils/contracts.ts (already expanded)
  - src/utils/rolodex.ts (already expanded)
  - src/utils/session-vault.ts (already expanded)
  - src/components/sections/PerformerContracts.css
- src/components/AnnouncePost.tsx
  - src/types/index.ts (already expanded)
  - src/utils/socialPost.ts (already expanded)
  - src/components/Modal.tsx (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/components/AnnouncePost.css
- src/components/sections/ArtistsSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/components/sections/ArtistProfile.tsx
    - src/types/index.ts (already expanded)
    - src/utils/media.ts (already expanded)
    - src/utils/mediaStore.ts (already expanded)
    - src/utils/useMediaUrl.ts (already expanded)
    - src/components/sections/PerformerProfile.css (already expanded)
    - src/components/useConfirm.tsx (already expanded)
- src/components/sections/ScheduleSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/utils/media.ts (already expanded)
  - src/utils/mediaStore.ts (already expanded)
  - src/components/TrimControls.tsx (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/components/ShowTimeline.tsx
    - src/types/index.ts (already expanded)
    - src/utils/showTimeline.ts (already expanded)
    - src/utils/elapsed.ts (already expanded)
    - src/components/ShowTimeline.css
  - src/utils/cuePerformer.ts
    - src/types/index.ts (already expanded)
  - src/components/useConfirm.tsx (already expanded)
  - src/utils/showTiming.ts (already expanded)
  - src/utils/scheduleTemplates.ts
    - src/types/index.ts (already expanded)
    - src/utils/showTiming.ts (already expanded)
    - src/utils/elapsed.ts (already expanded)
  - src/components/ScheduleTemplates.tsx
    - src/types/index.ts (already expanded)
    - src/utils/scheduleTemplates.ts (already expanded)
    - src/components/Modal.tsx (already expanded)
    - src/components/useConfirm.tsx (already expanded)
    - src/components/ScheduleTemplates.css
  - src/components/ScheduleGenerator.tsx
    - src/types/index.ts (already expanded)
    - src/utils/generateSchedule.ts
      - src/utils/id.ts (already expanded)
      - src/utils/elapsed.ts (already expanded)
      - src/types/index.ts (already expanded)
    - src/components/Modal.tsx (already expanded)
    - src/components/Icon.tsx (already expanded)
    - src/components/ScheduleGenerator.css
  - src/components/OnStagePicker.tsx
    - src/types/index.ts (already expanded)
  - src/components/AIImportFlow.tsx
    - src/types/index.ts (already expanded)
    - src/utils/id.ts (already expanded)
    - src/utils/aiExtractor.ts
      - src/types/index.ts (already expanded)
      - src/utils/id.ts (already expanded)
      - src/utils/api.ts (already expanded)
      - src/utils/showTiming.ts (already expanded)
    - src/utils/cuePerformer.ts (already expanded)
    - src/components/Icon.tsx (already expanded)
    - src/components/OnStagePicker.tsx (already expanded)
- src/components/sections/DJMusicSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/utils/media.ts (already expanded)
  - src/utils/mediaStore.ts (already expanded)
  - src/utils/musicLibrary.ts
    - src/types/index.ts (already expanded)
  - src/utils/pdfExport.ts
    - src/utils/introCards.ts
      - src/types/index.ts (already expanded)
    - src/utils/musicLibrary.ts (already expanded)
    - src/types/index.ts (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/components/TrimControls.tsx (already expanded)
  - src/components/TrackPreview.tsx
    - src/utils/useTrackPreview.ts
      - src/utils/audioEngine.ts (already expanded)
      - src/utils/audioSettings.ts
    - src/components/Icon.tsx (already expanded)
  - src/components/TrackPreview.css
  - src/utils/useTrackPreview.ts (already expanded)
  - src/components/useConfirm.tsx (already expanded)
- src/components/sections/StaffSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/components/useConfirm.tsx (already expanded)
- src/components/sections/VendorsSection.tsx
  - src/types/index.ts (already expanded)
  - src/utils/id.ts (already expanded)
  - src/components/useConfirm.tsx (already expanded)
- src/components/sections/ShowRecapSection.tsx
  - src/types/index.ts (already expanded)
- src/components/RunShow.tsx
  - src/types/index.ts (already expanded)
  - src/utils/audioEngine.ts (already expanded)
  - src/utils/walkOnFallback.ts
    - src/types/index.ts (already expanded)
  - src/utils/padColor.ts
  - src/utils/liveView.ts
    - src/utils/api.ts (already expanded)
    - src/utils/session-vault.ts (already expanded)
    - src/utils/theme.ts
    - src/utils/viewerAudio.ts
      - src/utils/api.ts (already expanded)
      - src/utils/encryption.ts (already expanded)
      - src/utils/mediaStore.ts (already expanded)
      - src/utils/session-vault.ts (already expanded)
  - src/utils/session-vault.ts (already expanded)
  - src/utils/theme.ts (already expanded)
  - src/utils/showTiming.ts (already expanded)
  - src/utils/soundboard.ts
    - src/types/index.ts (already expanded)
  - src/utils/useMediaUrl.ts (already expanded)
  - src/utils/mediaStore.ts (already expanded)
  - src/utils/viewerAudio.ts (already expanded)
  - src/utils/audioSettings.ts (already expanded)
  - src/components/Icon.tsx (already expanded)
  - src/components/useConfirm.tsx (already expanded)
  - src/utils/stageRemote.ts
- src/components/Modal.tsx (already expanded)
- src/utils/pdfExport.ts (already expanded)
- src/utils/showDate.ts (already expanded)
- src/utils/sectionSummary.ts
  - src/types/index.ts (already expanded)
  - src/utils/showTiming.ts (already expanded)
  - src/utils/showDate.ts (already expanded)
- src/utils/liveView.ts (already expanded)
- src/utils/theme.ts (already expanded)
- src/utils/showStats.ts
  - src/types/index.ts (already expanded)
  - src/utils/musicLibrary.ts (already expanded)
- src/utils/musicLibrary.ts (already expanded)
- src/utils/terminology.ts
  - src/types/index.ts (already expanded)
- src/utils/hostChoices.ts
  - src/types/index.ts (already expanded)
- src/utils/contracts.ts (already expanded)
- src/utils/recurrence.ts
  - src/utils/showDate.ts (already expanded)
- src/utils/session-vault.ts (already expanded)
- src/utils/viewerAudio.ts (already expanded)
- src/components/ShowDetail.css
- src/components/useConfirm.tsx (already expanded)
```

## Shows dashboard
Entry: `src/components/ShowsDashboard.tsx`

```text
- src/types/index.ts
- src/utils/showsOverview.ts
  - src/types/index.ts (already expanded)
  - src/utils/showDate.ts
- src/utils/showDate.ts (already expanded)
- src/components/Icon.tsx
- src/components/ShowsDashboard.css
```

## Music library
Entry: `src/components/MusicLibrary.tsx`

```text
- src/types/index.ts
- src/utils/id.ts
- src/utils/media.ts
- src/utils/mediaStore.ts
  - src/utils/api.ts
  - src/utils/encryption.ts
  - src/utils/session-vault.ts
    - src/utils/encryption.ts (already expanded)
  - src/utils/media.ts (already expanded)
- src/utils/musicLibrary.ts
  - src/types/index.ts (already expanded)
- src/components/PageHeader.tsx
  - src/components/PageHeader.css
- src/components/TrimControls.tsx
  - src/utils/audioEngine.ts
    - src/utils/media.ts (already expanded)
    - src/utils/mediaStore.ts (already expanded)
  - src/utils/trim.ts
  - src/components/TrimControls.css
- src/components/TrackPreview.tsx
  - src/utils/useTrackPreview.ts
    - src/utils/audioEngine.ts (already expanded)
    - src/utils/audioSettings.ts
  - src/components/Icon.tsx
- src/components/TrackPreview.css
- src/utils/useTrackPreview.ts (already expanded)
- src/components/MusicLibrary.css
- src/components/useConfirm.tsx
  - src/components/Modal.tsx
    - src/components/Modal.css
  - src/components/useConfirm.css
```

## Settings and clicker pairing
Entry: `src/components/Settings.tsx`

```text
- src/utils/stageRemote.ts
- src/types/index.ts
- src/utils/theme.ts
- src/utils/terminology.ts
  - src/types/index.ts (already expanded)
- src/utils/id.ts
- src/components/PageHeader.tsx
  - src/components/PageHeader.css
- src/components/Icon.tsx
- src/components/Settings.css
- src/components/useConfirm.tsx
  - src/components/Modal.tsx
    - src/components/Modal.css
  - src/components/useConfirm.css
- src/utils/secure-storage.ts
  - src/types/index.ts (already expanded)
  - src/utils/encryption.ts
  - src/utils/session-vault.ts
    - src/utils/encryption.ts (already expanded)
  - src/utils/api.ts
  - src/utils/trash.ts
    - src/types/index.ts (already expanded)
  - src/utils/showSize.ts
    - src/types/index.ts (already expanded)
  - src/utils/showHealing.ts
    - src/types/index.ts (already expanded)
```

## Public live viewer
Entry: `src/components/LiveViewer.tsx`

```text
- src/utils/liveView.ts
  - src/utils/api.ts
  - src/utils/session-vault.ts
    - src/utils/encryption.ts
  - src/utils/theme.ts
  - src/utils/viewerAudio.ts
    - src/utils/api.ts (already expanded)
    - src/utils/encryption.ts (already expanded)
    - src/utils/mediaStore.ts
      - src/utils/api.ts (already expanded)
      - src/utils/encryption.ts (already expanded)
      - src/utils/session-vault.ts (already expanded)
      - src/utils/media.ts
    - src/utils/session-vault.ts (already expanded)
- src/utils/theme.ts (already expanded)
- src/utils/audioEngine.ts
  - src/utils/media.ts (already expanded)
  - src/utils/mediaStore.ts (already expanded)
- src/utils/viewerAudio.ts (already expanded)
```

## Public performer profile
Entry: `src/components/ProfilePage.tsx`

```text
- src/utils/introductionCredits.ts
  - src/types/index.ts
- src/types/index.ts (already expanded)
- src/utils/contracts.ts
  - src/utils/introductionCredits.ts (already expanded)
  - src/types/index.ts (already expanded)
  - src/utils/api.ts
  - src/utils/encryption.ts
  - src/utils/mediaStore.ts
    - src/utils/api.ts (already expanded)
    - src/utils/encryption.ts (already expanded)
    - src/utils/session-vault.ts
      - src/utils/encryption.ts (already expanded)
    - src/utils/media.ts
  - src/utils/rolodex.ts
    - src/types/index.ts (already expanded)
    - src/utils/id.ts
  - src/utils/showDate.ts
  - src/utils/session-vault.ts (already expanded)
- src/utils/imageResize.ts
- src/utils/media.ts (already expanded)
- src/utils/profileLink.ts
  - src/utils/introductionCredits.ts (already expanded)
  - src/types/index.ts (already expanded)
  - src/utils/api.ts (already expanded)
  - src/utils/contracts.ts (already expanded)
  - src/utils/encryption.ts (already expanded)
  - src/utils/session-vault.ts (already expanded)
- src/components/SigningPage.css
```

## Public signing
Entry: `src/components/SigningPage.tsx`

```text
- src/utils/introductionCredits.ts
  - src/types/index.ts
- src/utils/api.ts
- src/utils/imageResize.ts
- src/types/index.ts (already expanded)
- src/utils/contracts.ts
  - src/utils/introductionCredits.ts (already expanded)
  - src/types/index.ts (already expanded)
  - src/utils/api.ts (already expanded)
  - src/utils/encryption.ts
  - src/utils/mediaStore.ts
    - src/utils/api.ts (already expanded)
    - src/utils/encryption.ts (already expanded)
    - src/utils/session-vault.ts
      - src/utils/encryption.ts (already expanded)
    - src/utils/media.ts
  - src/utils/rolodex.ts
    - src/types/index.ts (already expanded)
    - src/utils/id.ts
  - src/utils/showDate.ts
  - src/utils/session-vault.ts (already expanded)
- src/utils/pdfPages.ts
- src/components/SigningPage.css
```

## Sign-in landing
Entry: `src/components/Login.tsx`

```text
- src/components/BrandMark.tsx
- src/components/Login.css
```
