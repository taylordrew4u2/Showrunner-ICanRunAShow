import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantPermissions } from './ChatGPTConnect';
import { ASSISTANT_PERMISSIONS } from '../utils/chatgpt';

const everything = ASSISTANT_PERMISSIONS.map((permission) => permission.scope).join(' ');
const render = (requested: string, ticked: string[]) => renderToStaticMarkup(createElement(AssistantPermissions, {
  clientName: 'Claude', requested, ticked: new Set(ticked), onToggle: () => {},
}));
const checkboxes = (html: string) => [...html.matchAll(/<label[^>]*><input([^>]*)\/?><span>([^<]*)<\/span><\/label>/g)]
  .map(([, attributes, label]) => ({ label, checked: /\bchecked=""/.test(attributes), disabled: /\bdisabled=""/.test(attributes) }));

describe('the assistant consent checkboxes', () => {
  it('lists every requested permission as a labelled checkbox inside a named group', () => {
    const html = render(everything, ASSISTANT_PERMISSIONS.map((permission) => permission.scope));
    expect(html).toMatch(/^<fieldset[^>]*><legend[^>]*>Allow Claude to<\/legend>/);
    expect(checkboxes(html).map((box) => box.label)).toEqual(ASSISTANT_PERMISSIONS.map((permission) => permission.label));
    expect(html).toContain('Move shows to Trash');
    expect(html).toContain('Send contract and profile links to performers on your behalf');
  });

  it('keeps seeing shows ticked and fixed, and shows the rest as they are ticked', () => {
    const boxes = checkboxes(render(everything, ['shows:write']));
    expect(boxes[0]).toMatchObject({ checked: true, disabled: true });
    expect(boxes[1]).toMatchObject({ checked: true, disabled: false });
    expect(boxes.slice(2).every((box) => !box.checked && !box.disabled)).toBe(true);
  });

  it('ticks and locks seeing the Rolodex while editing it is ticked', () => {
    const rolodex = (ticked: string[]) => checkboxes(render(everything, ticked)).find((box) => box.label === 'See the people in your Rolodex');
    expect(rolodex(['rolodex:write'])).toMatchObject({ checked: true, disabled: true });
    expect(render(everything, ['rolodex:write'])).toContain('Included while “Add and edit people in your Rolodex” is ticked.');
    expect(rolodex(['rolodex:read'])).toMatchObject({ checked: true, disabled: false });
    expect(rolodex([])).toMatchObject({ checked: false, disabled: false });
    // Editing the Rolodex itself can still be unticked.
    expect(checkboxes(render(everything, ['rolodex:write'])).find((box) => box.label === 'Add and edit people in your Rolodex')).toMatchObject({ checked: true, disabled: false });
  });

  it('offers only what the client asked for', () => {
    const boxes = checkboxes(render('shows:read links:send', ['links:send']));
    expect(boxes.map((box) => box.label)).toEqual(['See your shows, including lineups and running orders', 'Send contract and profile links to performers on your behalf']);
  });

  it('ties each explanation to its checkbox for screen readers', () => {
    const html = render(everything, []);
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(described.length).toBe(ASSISTANT_PERMISSIONS.filter((permission) => permission.required || permission.detail).length);
    for (const id of described) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Always included.');
    expect(html).toContain('Recently deleted');
  });
});
