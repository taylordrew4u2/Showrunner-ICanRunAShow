# Showrunner / I Can Run A Show — existing design system

Source of truth: src/App.css tokens, src/index.css, src/fonts.css and final src/design.css. Components are custom React 19 + TypeScript, styled with vanilla CSS. Preserve the established calendar-blue brand and readable venue console; this task is workflow improvement, not rebranding.

## Brand and assets
Use the actual `/brand/mark.svg` stage-and-cue mark through BrandMark. Do not replace it with initials, generic icons, invented marks or text-only branding. Identity text is “I Can Run A Show”. Inter variable font files live at public/fonts and are self-hosted. There is no new hero imagery requirement for operational screens.

## Palette and typography
Dark is the default: backdrop #0b1120, bg #111827, surface #1c2738, stronger surface #29364b, text #f3f6fc, muted #c0cbdc, border #35445b. Light: backdrop #e9eef6, bg #f6f8fc, white surface, text #182234, muted #526078, border #d7dfeb. Shared primary #4285f4 uses ink #07162c labels; contextual primary text is #8ab4f8 dark / #174ea6 light. Success green, amber warning and burnt-orange/red danger retain semantic meaning. RunShow always remains dark.

Inter for UI, monospace for timecodes/cue numbers, display stack reserved for public viewer posters. Type scale: .6875/.75/.8125/.875/.95/1.0625/1.25/1.5/1.75/2rem. Phone root text is intentionally enlarged to 19px below768px and20px below430px. Preserve this accessibility decision.

## Shape, spacing and interaction
Radii 4/7/10/14/18/22px, full999px. Spacing is a 4px base with 2px half-steps in dense rows; usual gaps8/10/12/16/24px. Panels use quiet borders and restrained shadows. At least44px coarse-pointer targets, >=16px touch input text, focus rings and reduced-motion support. Prefer concise operational labels with distinct selected, loading, playing, stopped and error states. Avoid decorative clutter on live controls.

## Layout and workflow constraints
The app has state-based destinations at `/`, not a URL router. Consistent top status rail; desktop navigation popover at900px and mobile bottom navigation below. Planning happens in ShowDetail → ScheduleSection; live operation is a full-screen RunShow overlay. Keep clear entry/exit and preserve current show context.

Schedule offers lineup generation, saved templates, AI import and manual building. Once populated, cue rows expose order, timing, description, person and optional music; ShowTimeline supplies overview. Preserve existing performer and host assignment, upload/trim and template workflows.

User requirements for this task: timer exists independently of audio; changing/advancing a section must not unexpectedly start music. Selecting a song starts it immediately (respect explicitly configured cue behavior); clicker starts/stops the selected track and remains usable after on-screen sliders. Keep music controls unambiguous and prominently report what is playing/selected; timer must never be a prerequisite for manual music playback. Physical Bluetooth volume-clicker pairing on Mac uses F18; on-screen fade controls must not swallow the mapped music shortcut. The current console has fade-in/out sliders, no master volume slider. Keep those fade controls visible and compact rather than hiding them behind a disclosure. Do not redesign away current keyboard shortcuts or existing state feedback.

Full primitive/layout implementation and recursively traced page candidates are in `.superdesign/init/`. Pass compact token context and only target-critical source slices for generation; never bulk-send full App or all raw CSS unnecessarily.

## Target composition brief
At a 1060×660 viewport, the current timer and audio/fade panels push actual song pads below the fold. Make music primary: visibly name the selected track, give explicit Music Start/Stop controls, bring song pads into the initial viewport, and move the independently operated timer into a compact adjacent area. Keep the running order accessible and clear. Fade controls remain visible but compact. The RunShow toolbar itself has only the show name; its full-screen overlay hides global navigation, so do not introduce an irrelevant brand header or sidebar into the console. Preserve established Inter, navy and calendar-blue style.
