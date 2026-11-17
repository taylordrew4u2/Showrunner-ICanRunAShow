import { describe, expect, it } from 'vitest';
import { checkUntrusted, FORBIDDEN_KEYS, parseUntrusted, UntrustedJsonError } from './untrusted';
import { validatePayload } from './schema';
import type { EditPayload } from './types';

const ctx = { appOrigins: ['https://icanrunashow.com', 'https://coproduce.icanrunashow.com'] };

/** A settings edit removing one email list row, in the [id, row] encoding. */
function emailRemoval(id: string): EditPayload {
  return {
    kind: 'edit',
    shows: [],
    settings: {
      target: 'settings',
      baseRevision: null,
      fields: [{
        field: 'emailList',
        kind: 'rows',
        idField: 'email',
        baseOrder: [id],
        proposedOrder: [],
        base: [[id, { id: 'e1', email: id, addedAt: '2026-07-01T00:00:00.000Z' }]],
        proposed: [],
      }],
    },
  };
}

function nested(depth: number): unknown {
  let value: unknown = 0;
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

describe('reading JSON from the other producer', () => {
  for (const name of FORBIDDEN_KEYS) {
    it(`refuses ${name} as a top-level key`, () => {
      expect(() => parseUntrusted(`{"${name}": {"polluted": true}}`)).toThrow(UntrustedJsonError);
    });

    it(`refuses ${name} as a nested key`, () => {
      expect(() => parseUntrusted(`{"kind":"edit","shows":[{"show":{"performers":[{"${name}":1}]}}]}`)).toThrow(UntrustedJsonError);
    });

    it(`refuses ${name} as a row id inside an [id, row] pair`, () => {
      expect(() => checkUntrusted(JSON.parse(JSON.stringify(emailRemoval(name))))).toThrow(UntrustedJsonError);
    });

    it(`refuses ${name} as a settings field name, a row's id field or a show key`, () => {
      const field = emailRemoval('fan@example.com');
      const settings = field.settings!;
      const asField = { ...field, settings: { ...settings, fields: [{ ...settings.fields[0], field: name }] } };
      const asIdField = { ...field, settings: { ...settings, fields: [{ ...settings.fields[0], idField: name }] } };
      const asShowKey = {
        kind: 'edit',
        shows: [{ target: 'show', op: 'update', showId: 's1', baseRevision: null, keys: [name], base: {}, proposed: {} }],
        settings: null,
      };
      for (const payload of [asField, asIdField, asShowKey]) {
        // These names are values, not keys, so the walk lets them through and
        // the schema, which knows every field and key by name, refuses them.
        const value = parseUntrusted(JSON.stringify(payload));
        expect(validatePayload(value, ctx).payload).toBeNull();
      }
    });
  }

  it('leaves the prototype alone while it looks', () => {
    expect(() => parseUntrusted('{"__proto__": {"polluted": true}}')).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts sixteen levels of nesting and refuses seventeen', () => {
    expect(() => checkUntrusted(nested(16))).not.toThrow();
    expect(() => checkUntrusted(nested(17))).toThrow(UntrustedJsonError);
  });

  it('accepts 100,000 values and refuses 100,001', () => {
    // The list itself counts as one.
    expect(() => checkUntrusted(new Array(99_999).fill(0))).not.toThrow();
    expect(() => checkUntrusted(new Array(100_000).fill(0))).toThrow(UntrustedJsonError);
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseUntrusted('{nope')).toThrow(UntrustedJsonError);
  });

  it('round-trips a valid payload', () => {
    const payload = emailRemoval('fan@example.com');
    const value = parseUntrusted(JSON.stringify(payload));
    expect(value).toEqual(payload);
    expect(validatePayload(value, ctx)).toEqual({ payload, problems: [] });
  });

  it('lets the ordinary words through as values', () => {
    expect(() => checkUntrusted({ text: 'constructor', items: ['prototype', '__proto__'] })).not.toThrow();
  });
});
