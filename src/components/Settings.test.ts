import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Settings } from './Settings';
import { DEFAULT_SETTINGS } from '../types';

const render = (props: Partial<Parameters<typeof Settings>[0]> = {}) => renderToStaticMarkup(createElement(Settings, {
  settings: DEFAULT_SETTINGS,
  onSave: () => undefined,
  onBack: () => undefined,
  username: 'Taylor',
  onLogout: () => undefined,
  ...props,
}));

describe('deleting the account from Settings', () => {
  it('is offered, and stays disarmed until the username is typed', () => {
    const html = render({ onDeleteAccount: async () => undefined });
    expect(html).toContain('Delete account');
    expect(html).toContain('Type your username, <strong>Taylor</strong>, to confirm');
    const button = html.match(/<button[^>]*>Delete my account<\/button>/)?.[0] ?? '';
    expect(button).toMatch(/disabled=""/);
  });

  it('is not offered where the app cannot carry it out', () => {
    expect(render()).not.toContain('Delete my account');
  });
});
