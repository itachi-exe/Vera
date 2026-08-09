const MARKETS = [
  { s: "mUSDC", n: "Vera USD", v: "1.0000", d: "+0.01%", up: true },
  { s: "mETH", n: "Vera Ether", v: "2,504.12", d: "+2.41%", up: true },
  { s: "mWBTC", n: "Vera Bitcoin", v: "64,991.40", d: "-1.36%", up: false },
  { s: "MON", n: "Monad", v: "0.0000", d: "testnet", up: true },
  { s: "SUPPLY", n: "mUSDC APY", v: "4.10%", d: "+0.12%", up: true },
  { s: "BORROW", n: "mUSDC APR", v: "5.20%", d: "-0.08%", up: false },
  { s: "TVL", n: "Total supplied", v: "$1.84M", d: "+0.51%", up: true },
  { s: "TRUST", n: "Median score", v: "706", d: "+4", up: true },
  { s: "LINES", n: "Open lines", v: "1,208", d: "+31", up: true },
  { s: "HEALTH", n: "Median factor", v: "1.62", d: "+0.03", up: true },
];

function Row({ reverse }) {
  // Duplicated once so the marquee wraps seamlessly.
  const items = [...MARKETS, ...MARKETS];
  return (
    <div className="ticker-row">
      <div className={`ticker-track${reverse ? " rev" : ""}`}>
        {items.map((m, i) => (
          <span className="ticker-item" key={`${m.s}-${i}`}>
            <span className="ticker-badge" aria-hidden="true">
              {m.s.slice(0, 2)}
            </span>
            <span className="ticker-meta">
              <strong>{m.s}</strong>
              <em>{m.n}</em>
            </span>
            <span className="ticker-val">{m.v}</span>
            <i className={m.up ? "up" : "down"}>{m.d}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Ticker() {
  return (
    <div className="ticker" aria-hidden="true">
      <Row />
      <Row reverse />
      <Row />
    </div>
  );
}
