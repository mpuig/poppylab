import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { SITE_NAME } from "@/lib/site";
import { SiteBar, SiteFoot } from "./site-chrome";
import "./site.css";

export const metadata: Metadata = {
  title: `Page not found · ${SITE_NAME}`,
  robots: { index: false },
};

/** Any address the site has no page for, in the site's own header and footer. */
export default function NotFound() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar />
      <main id="main" className="reading">
        <article className="learn-article">
          <h1>There is no page here</h1>
          <p className="lead reading-lead">
            The address may be mistyped, or the page may have moved. The live
            demo and Learn are the best places to start.
          </p>
          <div className="actions">
            <a className="button" href="/playground">
              Try the live demo <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="button ghost" href="/learn">
              Learn how it works
            </a>
          </div>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}
