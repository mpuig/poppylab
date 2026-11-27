"use client";

import { useEffect, useState } from "react";

/** The home's sections that the bar links to, in page order. */
const sections = [
  ["why", "Why it exists"],
  ["how", "How it works"],
  ["who", "Who it's for"],
  ["try", "Try it"],
] as const;

/** How far under the top of the window a section must reach to count as the one being read. */
const READING_LINE = 120;

/**
 * The bar's links. On Learn and Developers the page marks itself; on the home
 * the section under the reading line is marked as the visitor scrolls, and
 * nothing is marked above the first section or between two of them.
 */
export function BarNav({
  current,
  posts = false,
}: {
  current?: "developers" | "learn" | "posts" | undefined;
  /** Whether there is a post, so Posts has a link. */
  posts?: boolean;
}) {
  const [section, setSection] = useState<string>();

  useEffect(() => {
    const found = sections
      .map(([id]) => document.getElementById(id))
      .filter((element) => element !== null);
    if (!found.length) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setSection(
        found.find((element) => {
          const { top, bottom } = element.getBoundingClientRect();
          return top <= READING_LINE && bottom > READING_LINE;
        })?.id,
      );
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <nav aria-label="Sections">
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`/#${id}`}
          data-label={label}
          aria-current={section === id ? "location" : undefined}
        >
          {label}
        </a>
      ))}
      <a
        href="/learn"
        data-label="Learn"
        aria-current={current === "learn" ? "page" : undefined}
      >
        Learn
      </a>
      <a
        href="/developers"
        data-label="Developers"
        aria-current={current === "developers" ? "page" : undefined}
      >
        Developers
      </a>
      {posts && (
        <a
          href="/posts"
          data-label="Posts"
          aria-current={current === "posts" ? "page" : undefined}
        >
          Posts
        </a>
      )}
    </nav>
  );
}
