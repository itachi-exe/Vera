import Logo from "./Logo";

const COLS = [
  {
    h: "Product",
    links: [
      { t: "How it works", href: "#how" },
      { t: "Trust score", href: "#trust" },
      { t: "Features", href: "#features" },
      { t: "Open the app", href: "#demo" },
    ],
  },
  {
    h: "Learn",
    links: [
      { t: "What is CVI", href: "#faq" },
      { t: "What is CVA", href: "#faq" },
      { t: "FAQ", href: "#faq" },
    ],
  },
  {
    h: "Built on",
    links: [
      { t: "Monad", href: "https://monad.xyz" },
      { t: "Cleanverse", href: "https://cleanverse.com" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="foot">
      <div className="container">
        <hr className="rule" />

        <div className="foot-grid">
          <div className="foot-brand">
            <Logo size={20} />
            <p>
              Trust-based lending. Verified identity and on-chain compliance set your
              borrowing power, not collateral alone.
            </p>
          </div>

          {COLS.map((c) => (
            <div className="foot-col" key={c.h}>
              <h3>{c.h}</h3>
              <ul>
                {c.links.map((l) => (
                  <li key={l.t}>
                    <a href={l.href}>{l.t}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="foot-col">
            <h3>Connect</h3>
            <ul>
              <li>
                <a href="https://t.me/Cleanverselabs">Telegram</a>
              </li>
            </ul>
          </div>
        </div>

        <hr className="rule" />

        <div className="foot-legal">
          <p>© {new Date().getFullYear()} Vera. Built by TheSpiders.</p>
          <p>
            Testnet software. Mock assets, no value. Nothing here is financial advice or
            an offer of credit.
          </p>
        </div>
      </div>
    </footer>
  );
}
