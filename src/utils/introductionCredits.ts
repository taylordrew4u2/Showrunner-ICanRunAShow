import type { ContractField } from '../types';

export const INTRODUCTION_CREDITS_LABEL = 'Credits for your stage introduction';
export const INTRODUCTION_CREDITS_PLACEHOLDER =
  'Which credits should the host mention when bringing you onstage?';

/** Clarify the original default on previously sent links without changing saved answers. */
export function clarifyIntroductionCredits(field: ContractField): ContractField {
  if (!['how to credit you', 'credits'].includes(field.label.trim().toLowerCase())) return field;
  return {
    ...field,
    label: INTRODUCTION_CREDITS_LABEL,
    placeholder: INTRODUCTION_CREDITS_PLACEHOLDER,
  };
}
