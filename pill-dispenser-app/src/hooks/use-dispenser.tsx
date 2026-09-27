import { createContext, useContext, type ReactNode } from 'react';

import { useBleCounter } from '@/hooks/use-ble-counter';
import type { UseBleCounterResult } from '@/lib/ble-counter';

const DispenserContext = createContext<UseBleCounterResult | null>(null);

/**
 * Holds the single Bluetooth link with the pill dispenser.
 *
 * The ESP32 only serves one client, so every screen shares one link instead of
 * opening its own: the front page drives the conversation, the medication table
 * reads the names, and the settings screen writes servo angles.
 */
export function DispenserProvider({ children }: { children: ReactNode }) {
  const dispenser = useBleCounter();

  return <DispenserContext.Provider value={dispenser}>{children}</DispenserContext.Provider>;
}

/** The shared dispenser link. Requires a `DispenserProvider` above the caller. */
export function useDispenser(): UseBleCounterResult {
  const dispenser = useContext(DispenserContext);
  if (!dispenser) {
    throw new Error('useDispenser must be used inside a DispenserProvider.');
  }
  return dispenser;
}
