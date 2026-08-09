/**
 * Wallet connection and contract interaction for the live Vera pool.
 *
 * When deployed, the pool address comes from `contracts/deployments/<chainid>.json`.
 * Until then the frontend reads from the demo state in useVera.js.
 */

export const MONAD_CHAIN_ID = 10143;

/* ------------------------------------------------------------------ *
 *  Provider discovery (EIP-6963)
 * ------------------------------------------------------------------ */

/**
 * `window.ethereum` is one slot that every extension writes to, so with more
 * than one wallet installed it holds whichever won the injection race — not
 * necessarily the one the user meant. EIP-6963 replaces the race with an
 * announcement: the page asks, each wallet answers with its own provider and
 * identifying metadata, and the user picks.
 *
 * This matters here specifically because Monad is a testnet. The kind of person
 * evaluating Vera is likely to have several wallets installed, which is exactly
 * the case `window.ethereum` handles worst.
 *
 * Discovery is additive. One wallet, or a wallet too old to announce, still
 * resolves through `window.ethereum` exactly as before — so this cannot regress
 * the single-wallet path.
 */
const announced = new Map(); // rdns -> { info, provider }
const subscribers = new Set();
const STORAGE_KEY = "vera.wallet.rdns";

let selectedRdns = null;

function notify() {
  const list = discoveredWallets();
  for (const fn of subscribers) fn(list);
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event.detail;
    if (!detail?.info?.rdns || !detail.provider) return;
    announced.set(detail.info.rdns, { info: detail.info, provider: detail.provider });
    notify();
  });

  // Wallets announce on request and also spontaneously on injection, so the
  // listener has to be registered before this fires — a request dispatched
  // first would miss every wallet already loaded.
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  try {
    selectedRdns = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing or a blocked storage partition. A remembered choice is a
    // convenience, not a requirement — fall through to the default provider.
  }
}

/** Announced wallets, as `{ rdns, name, icon }`. Safe to call during render. */
export function discoveredWallets() {
  return [...announced.values()].map(({ info }) => ({
    rdns: info.rdns,
    name: info.name,
    icon: info.icon,
  }));
}

/** Subscribe to discovery. Wallets can announce late, so this can fire again. */
export function onWalletsDiscovered(fn) {
  subscribers.add(fn);
  fn(discoveredWallets());
  return () => subscribers.delete(fn);
}

/** Remember which wallet the user chose, so a reload reconnects to that one. */
export function selectWallet(rdns) {
  selectedRdns = rdns;
  try {
    if (rdns) window.localStorage.setItem(STORAGE_KEY, rdns);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal — the choice just will not survive a reload.
  }
}

export function selectedWallet() {
  return selectedRdns;
}

/**
 * The provider every call below goes through.
 *
 * Order matters: an explicit choice wins; a single announced wallet needs no
 * choice; otherwise fall back to the legacy slot. With several wallets
 * announced and none chosen, `window.ethereum` is still the honest answer —
 * picking one arbitrarily is the bug this exists to avoid, so the UI asks.
 */
export function provider() {
  if (typeof window === "undefined") return null;
  if (selectedRdns && announced.has(selectedRdns)) return announced.get(selectedRdns).provider;
  if (announced.size === 1) return [...announced.values()][0].provider;
  return window.ethereum ?? null;
}

/** True when a choice is needed: several wallets announced and none selected. */
export function needsWalletChoice() {
  return announced.size > 1 && !(selectedRdns && announced.has(selectedRdns));
}

/** Whether any provider is available at all. Safe to call during render. */
export function hasInjectedWallet() {
  return typeof window !== "undefined" && (announced.size > 0 || !!window.ethereum);
}

/**
 * Which account is already authorised, without prompting.
 *
 * `eth_accounts` differs from `eth_requestAccounts` in that it never opens the
 * wallet — so this restores a session on reload without a popup on every visit.
 */
export async function readConnectedAccount() {
  const eth = provider();
  if (!eth) return null;
  try {
    const accounts = await eth.request({ method: "eth_accounts" });
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Current chain as a number, or null if it cannot be read. */
export async function readChainId() {
  const eth = provider();
  if (!eth) return null;
  try {
    const hex = await eth.request({ method: "eth_chainId" });
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

/**
 * Subscribe to account and chain changes. Returns an unsubscribe function.
 *
 * Both matter: an account switch invalidates the score on screen, and a network
 * switch invalidates the pool address. Neither fires a page load, so without
 * this the UI keeps showing a number that belongs to a wallet that is no longer
 * connected.
 */
export function onWalletEvents({ onAccountsChanged, onChainChanged }) {
  // Bind to the provider resolved now and unbind from that same object later.
  // Re-resolving inside the cleanup would leak a listener on the old wallet if
  // the selection changed in between, and leave it firing into a stale closure.
  const eth = provider();
  if (!eth) return () => {};

  const accounts = (list) => onAccountsChanged?.(list?.[0] ?? null);
  const chain = (hex) => onChainChanged?.(parseInt(hex, 16));

  eth.on?.("accountsChanged", accounts);
  eth.on?.("chainChanged", chain);

  return () => {
    eth.removeListener?.("accountsChanged", accounts);
    eth.removeListener?.("chainChanged", chain);
  };
}

export async function connectWallet(rdns) {
  // An explicit pick is recorded before connecting, so the prompt that opens
  // belongs to the wallet the user named rather than to the injection winner.
  if (rdns) selectWallet(rdns);

  const eth = provider();
  if (!eth) {
    return { ok: false, reason: "No wallet found. Install MetaMask or another provider." };
  }

  try {
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      return { ok: false, reason: "No accounts returned" };
    }

    const chainId = await eth.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== MONAD_CHAIN_ID) {
      return {
        ok: false,
        // The address is real and worth showing even though the chain is wrong —
        // the user is connected, just pointed at the wrong network, and hiding
        // the address makes that read as a failed connection.
        address: accounts[0],
        chainId: parseInt(chainId, 16),
        reason: `Switch to Monad testnet (chain ${MONAD_CHAIN_ID})`,
        wrongChain: true,
      };
    }

    return { ok: true, address: accounts[0], chainId: MONAD_CHAIN_ID };
  } catch (err) {
    // 4001 is the user closing the prompt, not a fault. Say so plainly rather
    // than surfacing a provider stack message.
    if (err.code === 4001) return { ok: false, rejected: true, reason: "Connection rejected" };
    return { ok: false, reason: err.message || "Connection rejected" };
  }
}

/**
 * Actually disconnect, rather than only forgetting locally.
 *
 * Clearing React state is not a disconnect: the wallet still has the site
 * authorised, so `eth_accounts` keeps returning the address and the restore
 * effect reconnects on the next load. EIP-2255 `wallet_revokePermissions` is
 * what withdraws that authorisation.
 *
 * The remembered EIP-6963 choice is dropped too — otherwise the next connect
 * silently reuses the old wallet instead of asking.
 *
 * Not every wallet implements revoke, so a rejection here is not a failure:
 * the caller clears its state either way. This reports whether the permission
 * was genuinely withdrawn so the caller can tell the two apart.
 */
export async function disconnectWallet() {
  const eth = provider();
  selectWallet(null);
  if (!eth) return { revoked: false };

  try {
    await eth.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
    return { revoked: true };
  } catch {
    return { revoked: false };
  }
}

export async function switchToMonad() {
  const eth = provider();
  if (!eth) return { ok: false };

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${MONAD_CHAIN_ID.toString(16)}` }],
    });
    return { ok: true };
  } catch (err) {
    // 4902 means the chain is not added yet — fall through to add it
    if (err.code !== 4902) {
      return { ok: false, reason: err.message };
    }

    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${MONAD_CHAIN_ID.toString(16)}`,
            chainName: "Monad Testnet",
            rpcUrls: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz"],
            nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
            // explorer.testnet.monad.xyz is dead — NXDOMAIN as of 2026-08-08.
            // The explorer was rebranded: testnet.monadexplorer.com now
            // 308-redirects here. MetaMask only syntax-checks this field, so
            // the stale host was accepted and then produced broken links
            // rather than a visible failure.
            blockExplorerUrls: ["https://testnet.monadvision.com"],
          },
        ],
      });
      return { ok: true };
    } catch (addErr) {
      return { ok: false, reason: addErr.message || "Failed to add Monad network" };
    }
  }
}

/**
 * Read deployment addresses. Returns null when the pool has not been deployed yet.
 */
export async function loadDeployment() {
  try {
    const res = await fetch(`/deployments/${MONAD_CHAIN_ID}.json`);
    if (!res.ok) {
      // Drain the body before discarding the response. Returning straight from
      // here leaves the stream unread and the connection open, which is the
      // normal case rather than the rare one: until the pool is deployed to
      // Monad there is no such file, so every load of /app 404s and leaks one.
      // It also keeps the page from ever reaching network idle, which is what
      // surfaced it — scripts/a11y-audit.mjs hung on the production build.
      await res.body?.cancel();
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}
