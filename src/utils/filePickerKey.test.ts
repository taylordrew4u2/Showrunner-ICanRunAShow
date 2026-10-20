import { describe, expect, it, vi } from 'vitest';
import { openFilePickerOnKey } from './filePickerKey';

/** A focused "Add a photo" label with its hidden file input inside. */
function keyOnPicker(key: string) {
  const input = { click: vi.fn() };
  const event = {
    key,
    preventDefault: vi.fn(),
    currentTarget: { querySelector: (selector: string) => (selector === 'input[type="file"]' ? input : null) },
  };
  openFilePickerOnKey(event as never);
  return { input, event };
}

describe('choosing a photo from the keyboard', () => {
  it('opens the file chooser on Enter', () => {
    // A browser activates a focused button or link from the keyboard, never a
    // focused label, so without this a keyboard-only signer could reach
    // "Add a photo" and never get past it, and the photo is required to sign.
    const { input, event } = keyOnPicker('Enter');
    expect(input.click).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('opens it on Space, without scrolling the page', () => {
    const { input, event } = keyOnPicker(' ');
    expect(input.click).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves every other key alone, so Tab still moves on', () => {
    const { input, event } = keyOnPicker('Tab');
    expect(input.click).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
