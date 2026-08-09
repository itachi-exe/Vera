"use client";

import { useEffect, useState } from "react";

/**
 * False until React has hydrated on the client.
 *
 * Server-rendered buttons exist in the DOM before their onClick handlers are
 * attached. On localhost that gap is invisible; over a LAN (phone testing on
 * the dev bundle) it can last seconds, during which taps do nothing at all
 * and the UI gives no reason why. Gate interactive controls on this so they
 * read as pending instead of broken.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
