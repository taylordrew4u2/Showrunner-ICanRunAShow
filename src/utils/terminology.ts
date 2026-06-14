import type { AppSettings } from '../types';

/**
 * The word a producer uses for the people in their Rolodex. Comedy shows book
 * "Comics", drag shows book "Queens", music shows book "Artists", and so on.
 * Derived from the show types chosen during onboarding, and overridable in
 * Settings.
 */
export interface RolodexTerm {
  singular: string;
  plural: string;
}

const TERM_BY_SHOW_TYPE: Record<string, RolodexTerm> = {
  Comedy: { singular: 'Comic', plural: 'Comics' },
  'Open Mic': { singular: 'Performer', plural: 'Performers' },
  Improv: { singular: 'Improviser', plural: 'Improvisers' },
  Music: { singular: 'Artist', plural: 'Artists' },
  Variety: { singular: 'Act', plural: 'Acts' },
  Theater: { singular: 'Actor', plural: 'Actors' },
  Burlesque: { singular: 'Performer', plural: 'Performers' },
  Drag: { singular: 'Queen', plural: 'Queens' },
  Magic: { singular: 'Magician', plural: 'Magicians' },
  Dance: { singular: 'Dancer', plural: 'Dancers' },
  'Podcast / Live Recording': { singular: 'Guest', plural: 'Guests' },
  'Corporate / Private Event': { singular: 'Performer', plural: 'Performers' },
};

// Preserves the original wording for accounts that never picked a show type.
const DEFAULT_TERM: RolodexTerm = { singular: 'Comic', plural: 'Comics' };

/** The term implied by a set of show types, before any manual override. */
export function defaultRolodexTerm(showTypes: string[] | undefined): RolodexTerm {
  for (const type of showTypes ?? []) {
    if (TERM_BY_SHOW_TYPE[type]) return TERM_BY_SHOW_TYPE[type];
  }
  return DEFAULT_TERM;
}

/** The term to actually display: a manual override wins, else the derived one. */
export function getRolodexTerm(
  settings: Pick<AppSettings, 'showTypes' | 'rolodexTermSingular' | 'rolodexTermPlural'>,
): RolodexTerm {
  const base = defaultRolodexTerm(settings.showTypes);
  return {
    singular: settings.rolodexTermSingular?.trim() || base.singular,
    plural: settings.rolodexTermPlural?.trim() || base.plural,
  };
}
