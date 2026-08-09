"use client";

/**
 * Floating bottom tab bar, ported from the reference app: five slots with the
 * centre one raised as a mint FAB, icon over label, active label in mint.
 */

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {[
        [3, 3],
        [13, 3],
        [3, 13],
        [13, 13],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="8"
          height="8"
          rx="2.2"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      ))}
    </svg>
  );
}

function IconTrend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 16.5 9 10l4 4 7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 6.5h5v5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAgent() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5c.6 3.7 1.8 4.9 5.5 5.5-3.7.6-4.9 1.8-5.5 5.5-.6-3.7-1.8-4.9-5.5-5.5 3.7-.6 4.9-1.8 5.5-5.5Z"
        fill="currentColor"
      />
      <path
        d="M18 14.5c.3 1.9.9 2.5 2.8 2.8-1.9.3-2.5.9-2.8 2.8-.3-1.9-.9-2.5-2.8-2.8 1.9-.3 2.5-.9 2.8-2.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

const TABS = [
  { id: "home", label: "Home", Icon: IconHome },
  { id: "markets", label: "Markets", Icon: IconGrid },
  { id: "positions", label: "Positions", Icon: IconTrend },
  { id: "vera", label: "Vera", Icon: IconAgent },
];

export default function TabBar({ tab, setTab, onFab }) {
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const item = (t) => (
    <button
      key={t.id}
      className={`tab${tab === t.id ? " on" : ""}`}
      onClick={() => setTab(t.id)}
      aria-current={tab === t.id ? "page" : undefined}
    >
      <span className="tab-ico">
        <t.Icon />
      </span>
      <span className="tab-label">{t.label}</span>
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Primary">
      <div className="tabbar-inner">
        {left.map(item)}

        <button className="fab" onClick={onFab} aria-label="Actions">
          <IconSpark />
        </button>

        {right.map(item)}
      </div>
    </nav>
  );
}
