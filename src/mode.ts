/**
 * Session control/link status — whether Braincells can actually send this
 * session commands, independent of how recently it's been active.
 * Pure module (no node imports) so both main-thread rendering and the
 * renderer can use it.
 */
export type SessionMode = 'watching' | 'reconnecting' | 'wired';

export const MODE_TITLES: Record<SessionMode, string> = {
  watching: 'Watching — read only',
  reconnecting: 'Reconnecting…',
  wired: 'Wired — live control',
};
