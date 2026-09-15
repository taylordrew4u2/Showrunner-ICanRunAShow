import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  alreadyPending,
  collectFieldAnswers,
  contractNameFromFile,
  documentHash,
  fetchSigningDocument,
  fetchSigningRequest,
  generateSignKey,
  generateSignToken,
  missingRequiredFields,
  isRetryableSignatureError,
  newContractField,
  prefillFromShow,
  readSignKeyFromHash,
  requestsForContract,
  shortHash,
  signatureSummary,
  signerStatus,
  lineupSigned,
  signedFileName,
  signingUrl,
  sendSignature,
  splitIntoChunks,
  submitSignature,
  suggestedFields,
} from './contracts';
import { api, SUBMIT_TIMEOUT_MS } from './api';
import { encryptWithKey } from './encryption';
import { profileFromAnswers } from './signatureImport';
import type { SignatureRequest } from '../types';

afterEach(() => vi.restoreAllMocks());

const req = (over: Partial<SignatureRequest>): SignatureRequest => ({
  id: 'r', token: 't', key: 'k', contractId: 'c1', contractName: 'Agreement',
  signerName: '', sentAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('generateSignToken', () => {
  it('is URL-safe, so it survives being pasted into a link', () => {
    expect(generateSignToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not repeat — the token is the whole of the access control', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSignToken()));
    expect(seen.size).toBe(200);
  });

  it('carries a full 256 bits', () => {
    expect(generateSignKey().length).toBeGreaterThanOrEqual(42);
  });
});

describe('signingUrl', () => {
  it('puts the key in the fragment, never the query', () => {
    const url = signingUrl('https://example.com', 'TOK', 'KEY');
    expect(url).toBe('https://example.com/sign?t=TOK#k=KEY');
    expect(url.split('#')[0]).not.toContain('KEY');
  });

  it('round-trips through the hash reader', () => {
    const key = generateSignKey();
    const url = signingUrl('https://example.com', 'TOK', key);
    expect(readSignKeyFromHash('#' + url.split('#')[1])).toBe(key);
  });

  it('escapes a token so it cannot break out of the query', () => {
    expect(signingUrl('https://e.com', 'a&b=c', 'K')).toContain('/sign?t=a%26b%3Dc');
  });
});

describe('readSignKeyFromHash', () => {
  it('returns null when the link was shared without its fragment', () => {
    expect(readSignKeyFromHash('')).toBeNull();
    expect(readSignKeyFromHash('#')).toBeNull();
  });

  it('finds the key when other fragment params come first', () => {
    expect(readSignKeyFromHash('#a=1&k=ABC')).toBe('ABC');
  });
});

describe('documentHash', () => {
  it('is stable for the same bytes', () => {
    expect(documentHash('data:application/pdf;base64,AAA')).toBe(
      documentHash('data:application/pdf;base64,AAA'),
    );
  });

  it('changes when a single byte of the document changes', () => {
    expect(documentHash('data:application/pdf;base64,AAA')).not.toBe(
      documentHash('data:application/pdf;base64,AAB'),
    );
  });

  it('shortens to something a person can read off a receipt', () => {
    expect(shortHash(documentHash('x'))).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe('splitIntoChunks', () => {
  it('rebuilds the original exactly', () => {
    const text = 'abcdefghij';
    expect(splitIntoChunks(text, 3).join('')).toBe(text);
  });

  it('leaves a short document in one piece', () => {
    expect(splitIntoChunks('abc', 10)).toEqual(['abc']);
  });
});

describe('signatureSummary', () => {
  it('counts who has signed and who has not', () => {
    const summary = signatureSummary([
      req({ token: 'a', signed: { signedAt: 'x', typedName: 'A', documentHash: 'h' } }),
      req({ token: 'b' }),
      req({ token: 'c' }),
    ]);
    expect(summary).toEqual({ total: 3, signed: 1, waiting: 2 });
  });

  it('handles nothing sent yet', () => {
    expect(signatureSummary([])).toEqual({ total: 0, signed: 0, waiting: 0 });
  });
});

describe('requestsForContract', () => {
  it('keeps only this contract, newest first', () => {
    const list = requestsForContract(
      [
        req({ token: 'old', sentAt: '2026-01-01T00:00:00.000Z' }),
        req({ token: 'other', contractId: 'c2' }),
        req({ token: 'new', sentAt: '2026-06-01T00:00:00.000Z' }),
      ],
      'c1',
    );
    expect(list.map((r) => r.token)).toEqual(['new', 'old']);
  });
});

describe('alreadyPending', () => {
  const outstanding = [req({ signerName: 'Ada Cole' })];

  it('spots a second send to someone who has not signed yet', () => {
    expect(alreadyPending(outstanding, 'c1', 'Ada Cole')).toBe(true);
  });

  it('matches the way the Rolodex matches people, not byte-for-byte', () => {
    expect(alreadyPending(outstanding, 'c1', '  ada   cole ')).toBe(true);
  });

  it('does not warn once they have signed', () => {
    const signed = [req({ signerName: 'Ada Cole', signed: { signedAt: 'x', typedName: 'Ada Cole', documentHash: 'h' } })];
    expect(alreadyPending(signed, 'c1', 'Ada Cole')).toBe(false);
  });

  it('does not warn about a different contract', () => {
    expect(alreadyPending(outstanding, 'c2', 'Ada Cole')).toBe(false);
  });
});

describe('contractNameFromFile', () => {
  it('reads a filename back as words', () => {
    expect(contractNameFromFile('performer-agreement.pdf')).toBe('performer agreement');
    expect(contractNameFromFile('Photo_Release_2026.PDF')).toBe('Photo Release 2026');
  });

  it('leaves capitalisation alone, so names and initialisms survive', () => {
    expect(contractNameFromFile('McKay-W9.pdf')).toBe('McKay W9');
  });

  it('always returns something to show', () => {
    expect(contractNameFromFile('.pdf')).toBe('Contract');
  });
});

describe('signedFileName', () => {
  it('is safe to write to a filesystem', () => {
    expect(signedFileName('Performer Agreement', 'Ada Cole')).toBe(
      'Performer-Agreement-Ada-Cole.pdf',
    );
  });

  it('drops punctuation a download would choke on', () => {
    expect(signedFileName('Release / Waiver', 'D\'Arcy')).toBe('Release-Waiver-DArcy.pdf');
  });
});


describe('contract fields', () => {
  const fields = [
    { id: 'stage', label: 'Stage name' },
    { id: 'credit', label: 'How to credit you', required: true, multiline: true },
  ];

  it('names the required questions still blank, so the signer is told which', () => {
    expect(missingRequiredFields(fields, { stage: 'Ada' })).toEqual(['How to credit you']);
    expect(missingRequiredFields(fields, { credit: 'Ada Cole (she/her)' })).toEqual([]);
  });

  it('treats whitespace as blank — a space is not an answer', () => {
    expect(missingRequiredFields(fields, { credit: '   ' })).toEqual(['How to credit you']);
  });

  it('has nothing to require when a contract asks for nothing', () => {
    expect(missingRequiredFields(undefined, {})).toEqual([]);
    expect(collectFieldAnswers(undefined, {})).toEqual([]);
  });

  it('records answers against the label the signer saw, trimmed', () => {
    expect(collectFieldAnswers(fields, { stage: ' Lady A ', credit: 'Lady A' })).toEqual([
      { label: 'Stage name', value: 'Lady A' },
      { label: 'How to credit you', value: 'Lady A' },
    ]);
  });

  it('drops unanswered optional questions rather than filing empty rows', () => {
    expect(collectFieldAnswers(fields, { credit: 'Lady A' })).toEqual([
      { label: 'How to credit you', value: 'Lady A' },
    ]);
  });

  it('gives each new question its own id, so two blank rows stay distinct', () => {
    expect(newContractField().id).not.toBe(newContractField().id);
  });

  it('suggests a starting list that is all editable text', () => {
    const suggested = suggestedFields();
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.every((f) => f.label.trim().length > 0)).toBe(true);
    expect(new Set(suggested.map((f) => f.id)).size).toBe(suggested.length);
  });
});


describe('prefillFromShow', () => {
  const show = {
    showName: 'Late Night Laughs',
    date: '2026-03-14',
    time: '20:30',
    venueName: 'The Basement',
    location: 'Portland, OR',
  };
  const f = (id: string, label: string) => ({ id, label });

  it('answers the questions the show already answers', () => {
    const filled = prefillFromShow(
      [f('d', 'Show date'), f('v', 'Venue'), f('t', 'Set time'), f('n', 'Show name')],
      show,
    );
    expect(filled.d).toContain('2026');
    expect(filled.v).toBe('The Basement — Portland, OR');
    expect(filled.t).toBeTruthy();
    expect(filled.n).toBe('Late Night Laughs');
  });

  it('leaves questions about the signer alone', () => {
    expect(prefillFromShow([f('s', 'Stage name'), f('c', 'How to credit you')], show)).toEqual({});
  });

  it('does not mistake a date of birth for the show date', () => {
    expect(prefillFromShow([f('b', 'Date of birth')], show)).toEqual({});
  });

  it('fills nothing when there is no show, and nothing from an empty show', () => {
    expect(prefillFromShow([f('d', 'Show date')], undefined)).toEqual({});
    expect(prefillFromShow([f('d', 'Show date'), f('v', 'Venue')], {})).toEqual({});
  });
});

describe('signerStatus', () => {
  const signed = { signedAt: '2026-03-01T00:00:00.000Z', typedName: 'Ada', documentHash: 'h' };

  it('marks someone who was never sent anything as not booked', () => {
    expect(signerStatus([], 'Ada Cole')).toBe('none');
    expect(signerStatus([req({ signerName: 'Someone Else' })], 'Ada Cole')).toBe('none');
  });

  it('counts someone as signed the moment one agreement comes back', () => {
    expect(signerStatus([req({ signerName: 'Ada Cole', signed })], 'Ada Cole')).toBe('signed');
  });

  it('does not un-sign a comic because a second contract went out to them', () => {
    // The release sent in March cannot undo the agreement signed in February.
    const agreement = req({ signerName: 'Ada Cole', signed });
    const release = req({ token: 't2', signerName: 'Ada Cole' });
    expect(signerStatus([agreement, release], 'Ada Cole')).toBe('signed');
  });

  it('is waiting while everything sent is still out', () => {
    const one = req({ signerName: 'Ada Cole' });
    const two = req({ token: 't2', signerName: 'Ada Cole' });
    expect(signerStatus([one, two], 'Ada Cole')).toBe('waiting');
  });

  it('counts a bill as booked only by who has signed', () => {
    const requests = [
      req({ signerName: 'Ada Cole', signed }),
      req({ token: 't2', signerName: 'Ben Stone' }),
    ];
    expect(lineupSigned(requests, ['Ada Cole', 'Ben Stone', 'Cass Reed']))
      .toEqual({ signed: 1, total: 3 });
  });

  it('matches the way the Rolodex matches people, not by exact spelling', () => {
    expect(signerStatus([req({ signerName: 'Ada  COLE', signed })], 'ada cole')).toBe('signed');
  });
});

/**
 * The headshot a performer sends in for the flyer.
 *
 * It rides on the signature record because the signer has no account and no
 * media store — the same per-request key that protects the document and their
 * answers protects their photo.
 */
describe('a headshot sent with a signature', () => {
  it('is carried on the record when one was chosen', async () => {
    const posts: { token: string; signature: string }[] = [];
    vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
      posts.push(body as { token: string; signature: string });
      return {} as never;
    });

    const record = await submitSignature(
      'tok',
      'key',
      'Mona Sable',
      'data:application/pdf;base64,AAAA',
      [],
      'data:image/jpeg;base64,BBBB',
    );

    expect(record.headshot).toBe('data:image/jpeg;base64,BBBB');
    // It leaves the device encrypted, like everything else on the record.
    expect(posts[0].signature).not.toContain('BBBB');
  });

  it('is simply absent when they skipped it', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({} as never);

    const record = await submitSignature('tok', 'key', 'Dev Okonjo', 'data:application/pdf;base64,AAAA');

    expect(record.headshot).toBeUndefined();
  });
});

/**
 * Who they are, and the fact that they signed, are two different things.
 *
 * The producer already knows the performer's name when they send the contract
 * from a profile, so the signer should not have to retype it. But the name
 * field and the signature were once the same field, which meant the contract
 * arrived with the signature already typed in — a document that signed itself.
 */
describe('a name on file and a signature', () => {
  it('keeps the signature the signer typed separately from the name they were sent as', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({} as never);

    const record = await submitSignature(
      'tok',
      'key',
      'A. Sable',
      'data:application/pdf;base64,AAAA',
      [],
      undefined,
      'Mona Sable',
    );

    expect(record.typedName).toBe('A. Sable');
    expect(record.signerName).toBe('Mona Sable');
  });

  it('records no name of its own for a contract signed before the two were separate', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({} as never);

    const record = await submitSignature('tok', 'key', 'Mona Sable', 'data:application/pdf;base64,AAAA');

    expect(record.typedName).toBe('Mona Sable');
    expect(record.signerName).toBeUndefined();
  });
});

describe("a contract's starting questions", () => {
  const labels = suggestedFields().map((f) => f.label);

  it('asks where to tag them, which the profile has a box for', () => {
    expect(labels).toContain('Instagram or main social');
  });

  it('asks them in words the profile import recognises', () => {
    // Matched by label, so a reworded question silently stops filling its box.
    const filled = profileFromAnswers(
      suggestedFields().map((f) => ({
        label: f.label,
        value: f.label === 'Email' ? 'a@b.example' : `answer for ${f.label}`,
      })),
    );
    expect(filled.socialMedia).toBeTruthy();
    expect(filled.email).toBe('a@b.example');
    expect(filled.phone).toBeTruthy();
    expect(filled.credits).toBeTruthy();
  });

  it('still lets the show answer for itself', () => {
    expect(labels).toContain('Show date');
    expect(labels).toContain('Venue');
  });
});

/**
 * A signature that reaches the server has gone through, whatever the phone
 * managed to hear back.
 *
 * On venue wifi a write can land and lose its answer. That is not a failed
 * signature, and the signer must never be told it is — they press again, get
 * told it failed again, and text the producer instead.
 */
describe('submitting a signature on a bad connection', () => {
  const netFail = () => Object.assign(new Error('network'), { status: undefined });

  it('asks again when the request died before the server answered', async () => {
    let calls = 0;
    vi.spyOn(api, 'post').mockImplementation(async () => {
      calls++;
      if (calls < 3) throw netFail();
      return {} as never;
    });

    const record = await submitSignature('tok', 'key', 'Mona Sable', 'data:application/pdf;base64,AAAA');

    expect(calls).toBe(3);
    expect(record.typedName).toBe('Mona Sable');
  });

  it('sends the very same signature each time, never a second different one', async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
      bodies.push(body);
      if (++calls < 2) throw netFail();
      return {} as never;
    });

    await submitSignature('tok', 'key', 'Mona Sable', 'data:application/pdf;base64,AAAA');

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it('does not keep asking when the server has answered', async () => {
    // A 409 is the server saying it will not take this — already signed, or
    // withdrawn. Repeating it cannot change that.
    let calls = 0;
    vi.spyOn(api, 'post').mockImplementation(async () => {
      calls++;
      throw Object.assign(new Error('not_signable'), { status: 409 });
    });

    await expect(
      submitSignature('tok', 'key', 'Mona Sable', 'data:application/pdf;base64,AAAA'),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it.each([408, 429, 500, 502, 503])('retries a temporary %s response with the same encrypted submission', async (status) => {
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(Object.assign(new Error('temporary'), { status }))
      .mockResolvedValue({ ok: true });
    await sendSignature('tok', 'encrypted-record');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
  });

  it('lets the signing page own retries without waiting through three upload timeouts', async () => {
    const failure = Object.assign(new Error('temporary'), { status: 503 });
    const post = vi.spyOn(api, 'post').mockRejectedValue(failure);
    await expect(sendSignature('tok', 'encrypted-record', { attempts: 1 })).rejects.toBe(failure);
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/sign',
      { token: 'tok', signature: 'encrypted-record' }, { timeoutMs: SUBMIT_TIMEOUT_MS });
  });

  it('never classifies permanent refusals as a pending delivery', () => {
    for (const status of [400, 401, 403, 404, 409, 413]) {
      expect(isRetryableSignatureError({ status })).toBe(false);
    }
    expect(isRetryableSignatureError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('gives up rather than asking forever', async () => {
    let calls = 0;
    vi.spyOn(api, 'post').mockImplementation(async () => {
      calls++;
      throw netFail();
    });

    await expect(
      submitSignature('tok', 'key', 'Mona Sable', 'data:application/pdf;base64,AAAA'),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });
});

describe('opening a signing link', () => {
  const key = 'test-signing-key';
  const payload = { contractName: 'Agreement', signerName: 'Ada', total: 1 };

  it.each([undefined, 429, 500, 503])('preserves a temporary read failure (%s) so the page can retry', async (status) => {
    const failure = Object.assign(new Error('temporary'), { status });
    vi.spyOn(api, 'get').mockRejectedValue(failure);
    await expect(fetchSigningRequest('tok', key)).rejects.toBe(failure);
  });

  it('returns missing only when the link does not exist or cannot be decrypted', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    await expect(fetchSigningRequest('tok', key)).resolves.toBeNull();
    get.mockResolvedValueOnce({ payload: encryptWithKey(payload, 'wrong-key'), signature: null });
    await expect(fetchSigningRequest('tok', key)).resolves.toBeNull();
  });

  it('shows the stored signature after the original submission response was lost', async () => {
    const record = { typedName: 'Ada', signedAt: '2026-09-15', documentHash: 'hash' };
    vi.spyOn(api, 'get').mockResolvedValue({
      payload: encryptWithKey(payload, key), signature: encryptWithKey(record, key),
    });
    await expect(fetchSigningRequest('tok', key)).resolves.toEqual({ payload, signed: record });
  });

  it('does not offer to sign again when an existing receipt cannot be read', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      payload: encryptWithKey(payload, key), signature: encryptWithKey({ typedName: null }, key),
    });
    await expect(fetchSigningRequest('tok', key)).resolves.toBeNull();
  });
});

describe('loading the agreement document', () => {
  const key = 'test-document-key';

  it('reassembles every decrypted chunk in order', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: encryptWithKey('data:application/pdf;base64,', key), total: 2 })
      .mockResolvedValueOnce({ data: encryptWithKey('AAAA', key), total: 2 });
    await expect(fetchSigningDocument('tok', key, 2)).resolves.toBe('data:application/pdf;base64,AAAA');
  });

  it('preserves a temporary chunk failure for the page to retry', async () => {
    const failure = Object.assign(new Error('temporary'), { status: 503 });
    vi.spyOn(api, 'get').mockRejectedValue(failure);
    await expect(fetchSigningDocument('tok', key, 1)).rejects.toBe(failure);
  });

  it('reports a removed document as unavailable', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    await expect(fetchSigningDocument('tok', key, 1)).resolves.toBeNull();
  });

  it.each([null, {}, '', 123])('rejects a malformed chunk (%j) instead of joining a truncated document', async (part) => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ data: encryptWithKey('data:application/pdf;base64,AAAA', key), total: 2 })
      .mockResolvedValueOnce({ data: encryptWithKey(part, key), total: 2 });
    await expect(fetchSigningDocument('tok', key, 2)).resolves.toBeNull();
  });

  it('rejects mismatched chunk counts instead of presenting an incomplete agreement', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: encryptWithKey('data:application/pdf;base64,AAAA', key), total: 2 });
    await expect(fetchSigningDocument('tok', key, 1)).resolves.toBeNull();
  });

  it.each([0, -1, 1.5, 65, NaN])('rejects invalid chunk count %s before starting a request', async (total) => {
    const get = vi.spyOn(api, 'get');
    await expect(fetchSigningDocument('tok', key, total)).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
