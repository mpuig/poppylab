import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { LAB_REPOSITORY } from "@poppy-lab/pap-core";
import { LEARN_PAGES, findPage, renderPage } from "@/lib/learn";
import { SiteBar, SiteFoot } from "../../site-chrome";
import "../../site.css";

// Every page is built from docs/learn at build time; nothing else exists.
export const dynamicParams = false;

export function generateStaticParams() {
  return LEARN_PAGES.map((p) => ({ slug: p.slug ? [p.slug] : [] }));
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage((await params).slug?.[0]);
  if (!page) return {};
  const { title, description } = await renderPage(page);
  return {
    title: page.slug ? `${title} · Learn · Poppy Lab` : "Learn · Poppy Lab",
    description,
  };
}

export default async function Learn({ params }: Props) {
  const { slug } = await params;
  if (slug && slug.length > 1) notFound();
  const page = findPage(slug?.[0]);
  if (!page) notFound();
  const { title, html } = await renderPage(page);
  const index = LEARN_PAGES.indexOf(page);
  const next = LEARN_PAGES[index + 1];
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
            {LEARN_PAGES.map((p) => (
              <li key={p.slug}>
                <a
                  href={p.slug ? `/learn/${p.slug}` : "/learn"}
                  aria-current={p === page ? "page" : undefined}
                >
                  {p.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="learn-article">
          <h1>{title}</h1>
          {/* Our own Markdown from docs/learn, converted at build time. */}
          <div
            className="learn-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <footer className="learn-foot">
            {next && (
              <a className="learn-next" href={`/learn/${next.slug}`}>
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
