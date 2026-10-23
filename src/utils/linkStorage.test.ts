import { describe, expect, it } from 'vitest';
import { isLinkStorageFull } from './linkStorage';

describe('telling a full allowance from any other refusal', () => {
  it('is the server’s own code, not every 413', () => {
    const refusal = (status: number, code?: string) => Object.assign(new Error(code ?? 'failed'), { status, code });
    expect(isLinkStorageFull(refusal(413, 'link_storage_full'))).toBe(true);
    // Too big for one link is a smaller file, not freeing space.
    expect(isLinkStorageFull(refusal(413, 'payload_too_large'))).toBe(false);
    expect(isLinkStorageFull(refusal(403, 'forbidden'))).toBe(false);
    expect(isLinkStorageFull(new Error('The operation was aborted'))).toBe(false);
    expect(isLinkStorageFull(undefined)).toBe(false);
  });
});
