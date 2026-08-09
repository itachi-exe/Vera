"use client";

import { useState } from "react";
import { Mark } from "./Logo";

const QUOTES = [
  {
    q: "“I had no borrow history. Vera gave me a line anyway.”",
    who: "Vera scored this wallet 812 and opened at 78% LTV",
  },
  {
    q: "“Same collateral. Nearly double the draw.”",
    who: "Verified wallets clear 78% where anonymous ones stop at 45%",
  },
  {
    q: "“It checked compliance before it let me borrow.”",
    who: "Every draw passes a CVA check before the contract executes",
  },
];

export default function PullQuote() {
  const [i, setI] = useState(0);
  const active = QUOTES[i];

  return (
    <section className="sec quotes-sec">
      <div className="container quotes-inner">
        <p className="eyebrow reveal">You could just say</p>

        <blockquote className="serif quote reveal" key={i}>
          {active.q}
        </blockquote>

        <p className="quote-who reveal">
          <span className="quote-mark">
            <Mark size={11} />
          </span>
          {active.who}
        </p>

        <div className="quote-pager reveal">
          {QUOTES.map((_, n) => (
            <button
              key={n}
              className={`quote-dot${n === i ? " on" : ""}`}
              aria-label={`Quote ${n + 1}`}
              aria-current={n === i}
              onClick={() => setI(n)}
            />
          ))}
          <button className="quote-next" onClick={() => setI((v) => (v + 1) % QUOTES.length)}>
            See more <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
