"use client";

import { ArrowRight } from "lucide-react";
import { FEEDBACK_URL } from "@/lib/site";
import { SiteBar, SiteFoot } from "./site-chrome";
import "./site.css";

/**
 * A page that failed while it was shown, in the site's own header and
 * footer. Reloading loads the whole page again, so it works the same
 * whatever went wrong.
 */
export default function PageError() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar />
      <main id="main" className="reading">
        <article className="learn-article">
          <h1>This page couldn&apos;t be shown</h1>
          <p className="lead reading-lead">
            Something went wrong on the site while it showed this page. Reload
            it, or go on to the live demo or Learn.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
            <a className="button ghost" href="/playground">
              Try the live demo <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="button ghost" href="/learn">
              Learn how it works
            </a>
          </div>
          <p className="note">
            If it keeps happening, please{" "}
            <a href={FEEDBACK_URL}>open an issue on GitHub</a> and say which
            page it was.
          </p>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}
