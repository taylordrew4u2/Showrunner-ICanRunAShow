import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Login } from './Login';

describe('the username field on the sign-in screen', () => {
  it('is not capitalised or corrected by a phone keyboard', () => {
    // iOS capitalises the first letter of a text field by default, so the same
    // producer signs in as "Taylor" one day and "taylor" the next.
    const html = renderToStaticMarkup(createElement(Login, { onSignIn: () => undefined, onSignUp: () => undefined }));
    const username = html.match(/<input[^>]*autocomplete="username"[^>]*>/i)?.[0] ?? '';
    expect(username).toMatch(/autocapitalize="none"/i);
    expect(username).toMatch(/autocorrect="off"/i);
    expect(username).toMatch(/spellcheck="false"/i);
  });
});
