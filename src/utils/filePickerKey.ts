import type { KeyboardEvent } from 'react';

/**
 * Open a label's file chooser from the keyboard.
 *
 * The signing and profile pages style a label as the "Add a photo" button,
 * with the file input hidden inside it, because a bare file input on a phone
 * is a grey rectangle nobody presses. A click or a tap on the label opens the
 * chooser; Enter and Space do not, since browsers only activate buttons, links
 * and form controls from the keyboard. On the signing page the photo is
 * required, so a keyboard-only signer could focus the label and never sign.
 */
export function openFilePickerOnKey(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  // Space would otherwise scroll the page.
  event.preventDefault();
  event.currentTarget.querySelector<HTMLInputElement>('input[type="file"]')?.click();
}
