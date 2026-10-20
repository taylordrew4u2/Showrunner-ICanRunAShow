import { describe, expect, it } from 'vitest';
import { shouldRecheckPlan } from './billing';

describe('looking at the plan again when the producer comes back to the app', () => {
  it('looks after this page sent them to Stripe, whatever the plan was', () => {
    // Checkout, or the billing portal: either can change the plan, and
    // neither reliably comes back through ?billing=success.
    expect(shouldRecheckPlan({ sentToStripe: true, nativeShell: false, freePlan: true })).toBe(true);
    expect(shouldRecheckPlan({ sentToStripe: true, nativeShell: false, freePlan: false })).toBe(true);
    expect(shouldRecheckPlan({ sentToStripe: true, nativeShell: true, freePlan: true })).toBe(true);
  });

  it('looks in the iOS app while the account is on the free plan, since any upgrade happened on the web', () => {
    expect(shouldRecheckPlan({ sentToStripe: false, nativeShell: true, freePlan: true })).toBe(true);
  });

  it('leaves a paid account in the iOS app alone', () => {
    expect(shouldRecheckPlan({ sentToStripe: false, nativeShell: true, freePlan: false })).toBe(false);
  });

  it('leaves the web alone when nothing here went to Stripe', () => {
    expect(shouldRecheckPlan({ sentToStripe: false, nativeShell: false, freePlan: true })).toBe(false);
    expect(shouldRecheckPlan({ sentToStripe: false, nativeShell: false, freePlan: false })).toBe(false);
  });
});
