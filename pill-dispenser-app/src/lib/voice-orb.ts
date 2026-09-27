/**
 * Presentation logic for the voice orb on the front page.
 *
 * Kept free of React Native imports so the state mapping and palettes stay
 * testable with plain Node.
 */

/** What the front page orb is showing. */
export type OrbState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'linking' | 'offline';

/** How the Bluetooth link with the dispenser is doing, in orb terms. */
export type OrbConnection = 'connected' | 'pending' | 'unavailable';

export type OrbPalette = {
  /** Gradient of the sphere itself, top to bottom. */
  core: readonly [string, string];
  /** Soft halo behind the sphere. */
  glow: string;
  /** Orbit ring around the sphere. */
  ring: string;
  /** Dot riding the orbit ring, which marks the sphere as alive. */
  node: string;
};

export const ORB_PALETTES: Record<OrbState, OrbPalette> = {
  idle: { core: ['#1E1B4B', '#6D28D9'], glow: '#7C3AED', ring: '#8B5CF6', node: '#22D3EE' },
  connecting: { core: ['#082F49', '#0284C7'], glow: '#0EA5E9', ring: '#38BDF8', node: '#E0F2FE' },
  listening: { core: ['#042F2E', '#0D9488'], glow: '#14B8A6', ring: '#2DD4BF', node: '#CCFBF1' },
  speaking: { core: ['#4A044E', '#DB2777'], glow: '#EC4899', ring: '#F472B6', node: '#FCE7F3' },
  linking: { core: ['#3F2D0B', '#B45309'], glow: '#F59E0B', ring: '#FCD34D', node: '#FEF3C7' },
  offline: { core: ['#1F2937', '#4B5563'], glow: '#374151', ring: '#6B7280', node: '#D1D5DB' },
};

/** Line under the orb, telling the user what the orb is waiting for. */
export const ORB_HINTS: Record<OrbState, string> = {
  idle: 'Tap the orb, then say what to dispense.',
  connecting: 'Connecting to the medication assistant…',
  listening: 'Listening. Speak naturally, then pause.',
  speaking: 'The assistant is answering.',
  linking: 'Looking for the pill dispenser…',
  offline: 'Dispenser offline. Tap the orb to search again.',
};

/** What tapping the orb does, used as the accessible label of the button. */
export const ORB_ACTIONS: Record<OrbState, string> = {
  idle: 'Start talking to the medication assistant',
  connecting: 'Connecting to the medication assistant',
  listening: 'End the conversation with the medication assistant',
  speaking: 'End the conversation with the medication assistant',
  linking: 'Connecting to the pill dispenser',
  offline: 'Search for the pill dispenser again',
};

/** Turns the Bluetooth status of `use-ble-counter` into orb vocabulary. */
export function orbConnectionFor(status: string): OrbConnection {
  if (status === 'connected') return 'connected';
  if (status === 'error' || status === 'unsupported') return 'unavailable';
  return 'pending';
}

/**
 * Maps the ElevenLabs conversation status onto the orb.
 *
 * A live conversation wins over the Bluetooth link, so a dropped dispenser
 * does not hide an assistant that is still talking.
 */
export function resolveOrbState(
  conversationStatus: string,
  isSpeaking: boolean,
  connection: OrbConnection,
): OrbState {
  if (conversationStatus === 'connected') return isSpeaking ? 'speaking' : 'listening';
  if (conversationStatus === 'connecting') return 'connecting';
  if (connection === 'unavailable') return 'offline';
  if (connection === 'pending') return 'linking';
  return 'idle';
}

/** What a tap on the orb does. */
export type OrbTap = 'start' | 'end' | 'retry' | 'none';

/** Decides the single action a tap can trigger, so the page stays declarative. */
export function orbTapFor(state: OrbState, connection: OrbConnection): OrbTap {
  if (state === 'offline') return 'retry';
  if (state === 'connecting' || state === 'linking') return 'none';
  if (state === 'listening' || state === 'speaking') return 'end';
  return connection === 'connected' ? 'start' : 'none';
}
