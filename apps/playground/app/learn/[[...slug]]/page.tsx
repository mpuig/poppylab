import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY } from "@poppy-lab/pap-core";
import {
  LEARN_PAGES,
  findPage,
  renderPage,
  subsections,
  type LearnPage,
} from "@/lib/learn";
import { SiteBar, SiteFoot } from "../../site-chrome";
import { LearnSteps } from "../learn-steps";
import "../../site.css";
import "../learn.css";

// Every page is built from docs/learn at build time; nothing else exists.
export const dynamicParams = false;

export function generateStaticParams() {
  return LEARN_PAGES.map((p) => ({ slug: p.slug ? p.slug.split("/") : [] }));
}

const hrefOf = (page: LearnPage) =>
  page.slug ? `/learn/${page.slug}` : "/learn";

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage((await params).slug?.join("/"));
  if (!page) return {};
  const { title, description } = await renderPage(page);
  return {
    title: page.slug ? `${title} · Learn · Poppy Lab` : "Learn · Poppy Lab",
    description,
  };
}

export default async function Learn({ params }: Props) {
  const { slug } = await params;
  const page = findPage(slug?.join("/"));
  if (!page) notFound();
  const { title, html, parts } = await renderPage(page);
  const index = LEARN_PAGES.indexOf(page);
  const next = LEARN_PAGES[index + 1];
  // A section's own pages are listed under it while the reader is in it.
  const open = page.parent ?? page.slug;
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar current="learn" />
      <main id="main" className="learn">
        <nav className="learn-nav" aria-label="Learn pages">
          <p className="learn-nav-title">Learn</p>
          <ol>
            {LEARN_PAGES.filter((p) => !p.parent).map((p) => {
              const inside = p.slug === open ? subsections(p) : [];
              return (
                <li key={p.slug}>
                  <a
                    href={hrefOf(p)}
                    aria-current={p === page ? "page" : undefined}
                  >
                    {p.label}
                  </a>
                  {inside.length > 0 && (
                    <ol className="learn-nav-sub">
                      {inside.map((sub) => (
                        <li key={sub.slug}>
                          <a
                            href={hrefOf(sub)}
                            aria-current={sub === page ? "page" : undefined}
                          >
                            {sub.label}
                          </a>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <article className="learn-article">
          <h1>{title}</h1>
          {/* Our own Markdown from docs/learn, converted at build time. */}
          {parts ? (
            <>
              <div
                className="learn-body"
                dangerouslySetInnerHTML={{ __html: parts.before }}
              />
              <LearnSteps steps={parts.steps} />
              <div
                className="learn-body learn-after"
                dangerouslySetInnerHTML={{ __html: parts.after }}
              />
            </>
          ) : (
            <div
              className="learn-body"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          <footer className="learn-foot">
            {next && (
              <a className="learn-next" href={hrefOf(next)}>
                Next: {next.label}
              </a>
            )}
            <a href={`${LAB_REPOSITORY}/blob/main/docs/learn/${page.file}`}>
              This page on GitHub <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </footer>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}
