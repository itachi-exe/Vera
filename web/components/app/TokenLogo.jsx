/**
 * Official token artwork for the three pool assets.
 *
 * The mocks stand in for real assets — mUSDC for USDC, mETH for ETH, mWBTC for
 * WBTC — so they carry the real logos rather than a two-letter stand-in.
 *
 * Files are vendored under public/tokens/ from Trust Wallet's asset registry,
 * which is the issuer-submitted source wallets read. Vendored rather than
 * hotlinked: a remote image is a third-party request on every page load and a
 * blank badge whenever that host is slow.
 *
 * The three Monad ecosystem quotes carry their own marks, vendored the same way
 * from CoinGecko's issuer-submitted images: MON is the chain's own logo, aprMON
 * is aPriori's, shMON is ShMonad's. Used to identify the asset being quoted,
 * which is what a market row is for.
 *
 * A symbol with no artwork falls back to the original two-letter badge instead
 * of rendering a broken image, so an asset added later degrades quietly.
 */

const ART = {
  mUSDC: { src: "/tokens/usdc.png", label: "USDC" },
  mETH: { src: "/tokens/eth.png", label: "Ethereum" },
  mWBTC: { src: "/tokens/wbtc.png", label: "Wrapped Bitcoin" },
  MON: { src: "/tokens/mon.png", label: "Monad" },
  aprMON: { src: "/tokens/aprmon.png", label: "aPriori Staked MON" },
  shMON: { src: "/tokens/shmon.png", label: "ShMonad" },
};

export default function TokenLogo({ symbol, className = "row-badge" }) {
  const art = ART[symbol];

  if (!art) {
    return (
      <span className={className} aria-hidden="true">
        {String(symbol || "").replace("m", "").slice(0, 2)}
      </span>
    );
  }

  return (
    <span className={`${className} has-art`} aria-hidden="true">
      <img src={art.src} alt="" width={64} height={64} loading="lazy" decoding="async" />
    </span>
  );
}
