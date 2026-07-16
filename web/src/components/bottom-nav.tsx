"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Thumb-zone navigation.
 *
 * This is a phone product watched one-handed during a match, so the three
 * destinations live where the thumb already is rather than in a tab row at the
 * top of the screen. Labels stay under the icons — a football and a stack of
 * chips are not universal enough to stand alone.
 */

const NAV = [
  { href: "/", label: "Matches", icon: BallIcon },
  { href: "/pools", label: "Pools", icon: ChipsIcon },
  { href: "/me", label: "Me", icon: PersonIcon },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Main">
      <div className="bottom-nav-inner">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`bottom-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function BallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.5l3.2 2.3-1.2 3.8h-4L8.8 9.8 12 7.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 3v4.5M4.2 9.6l4.6.2M19.8 9.6l-4.6.2M7 20l1.8-6.4M17 20l-1.8-6.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChipsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6.5" rx="7.5" ry="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 6.5v5c0 1.77 3.36 3.2 7.5 3.2s7.5-1.43 7.5-3.2v-5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4.5 11.5v5c0 1.77 3.36 3.2 7.5 3.2s7.5-1.43 7.5-3.2v-5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
