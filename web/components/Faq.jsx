"use client";

import { useState } from "react";

const ITEMS = [
  {
    q: "What exactly am I borrowing?",
    a: "Mock ERC-20 assets on Monad testnet — mUSDC, mETH, and mWBTC. They behave like the real thing for the purposes of the protocol, but they carry no value outside the testnet.",
  },
  {
    q: "What is CVI?",
    a: "Cleanverse Identity. It issues a signed attestation that a wallet belongs to a verified person, without revealing who that person is. Vera reads the attestation and uses it as the identity component of your trust score.",
  },
  {
    q: "What is CVA, and why does it block me?",
    a: "Cleanverse Asset compliance. Before any draw executes, Vera checks the borrowing wallet against CVA. If the wallet fails, the contract refuses the draw rather than flagging it after the money has moved.",
  },
  {
    q: "How is my trust score calculated?",
    a: "Three inputs: your CVI identity attestation carries 30% of the weight, your on-chain history 45%, and your repayment record 25%. Every weight is published, and the score is recomputed on-chain.",
  },
  {
    q: "What happens if I do not verify?",
    a: "You can still use Vera. You just borrow as an anonymous wallet, which caps you at 45% loan-to-value instead of up to 90%. Nothing is withheld from you except the higher ceiling.",
  },
  {
    q: "Does Vera hold my collateral?",
    a: "No. The pool is non-custodial. Your collateral sits in a contract you can exit at any time, minus whatever is currently backing an open draw.",
  },
  {
    q: "What happens when I get liquidated?",
    a: "If your health factor falls below 1, your collateral can be liquidated to cover the debt. Vera shows the liquidation price before you draw, not after.",
  },
  {
    q: "Is any of this real money?",
    a: "Not yet. Vera runs on Monad testnet with mock assets. Treat it as a working demonstration of trust-based lending, not a place to put funds.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="sec">
      <div className="container">
        <h2 className="serif faq-title reveal">
          Questions you&apos;d
          <br />
          <em>actually ask</em>.
        </h2>

        <p className="faq-lede reveal">Straight answers, in the same plain words Vera uses.</p>

        <ul className="faq-list reveal">
          {ITEMS.map((it, i) => {
            const isOpen = open === i;
            return (
              <li key={it.q} className={isOpen ? "on" : ""}>
                <button
                  className="faq-q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  <span>{it.q}</span>
                  <span className="faq-chev" aria-hidden="true" />
                </button>
                <div className="faq-a" hidden={!isOpen}>
                  <p>{it.a}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
