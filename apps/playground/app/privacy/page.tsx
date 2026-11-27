import type { Metadata } from "next";
import { FEEDBACK_URL, SITE_NAME, pageMetadata } from "@/lib/site";
import { SiteBar, SiteFoot } from "../site-chrome";
import "../site.css";

export const metadata: Metadata = pageMetadata({
  title: `Privacy · ${SITE_NAME}`,
  description: `What ${SITE_NAME} keeps while you use it, where it is kept, for how long, and how to remove it.`,
  path: "/privacy",
});

// Inlined at build time (next.config.ts), as in the layout.
const analytics = Boolean(process.env.CF_WEB_ANALYTICS_TOKEN);

/**
 * Each sentence here follows the code: the visitor cookie and the runs'
 * lifetimes (`runs.ts` in pap-agent), the sign-in cookie
 * (`sign-in-cookie.ts`), the per-visitor storage (`worker/visitor.ts`,
 * `lib/visitor-storage.ts`), the budgets (`limits.ts`), the model settings
 * (`model-settings.tsx`) and the Companies' copies (`tenancy.ts` in
 * pap-company). Change it when they change.
 */
export default function Privacy() {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar />
      <main id="main" className="reading">
        <article className="learn-article">
          <h1>Privacy</h1>
          <p className="lead reading-lead">
            What {SITE_NAME} keeps while you use it, where, and for how long.
            Everything in the demo is fictional, and nothing here needs your
            real details.
          </p>
          <div className="learn-body">
            <h2 id="cookies">Cookies</h2>
            <p>
              When you use the playground, this site sets two kinds of cookie,
              both needed for the demo:
            </p>
            <ul>
              <li>
                <strong>A visitor cookie</strong>,{" "}
                <code>__Host-poppy_visitor</code>: a random value that keeps
                your conversations apart from everyone else&apos;s. It lasts
                seven days. The server stores only a hash of it, never the value
                itself.
              </li>
              <li>
                <strong>A sign-in cookie</strong>, <code>pap_oauth_…</code>: one
                for each sign-in at a company, so that only the browser where
                you pressed Sign in can finish it. It is sent only to the
                sign-in callback and lasts at most five minutes.
              </li>
            </ul>
            <p>
              There are no advertising or tracking cookies. Each fictional
              company&apos;s own site sets cookies of its own when you sign in
              there: one that recognises your browser for seven days, and others
              that last as long as your sign-in there.
            </p>

            <h2 id="conversations">Conversations and connected companies</h2>
            <p>
              Your conversations, and the connection to each company you
              connect, with its access tokens and keys, are kept on the server
              in Cloudflare storage, under the hash of your visitor cookie and
              sealed with a key only the server holds.
            </p>
            <ul>
              <li>
                A conversation stays open for 30 minutes. When it ends, its
                tokens and keys are deleted, and what was said stays readable in
                your list for seven days from its start. The list keeps at most
                20 conversations.
              </li>
              <li>
                Everything kept for your visitor cookie is deleted eight days
                after you last used the playground.
              </li>
              <li>
                <strong>Reset demo data</strong>, in the playground&apos;s list
                of conversations, ends your open conversations and deletes their
                tokens and keys, and every company gives you a fresh copy of its
                test customers the next time you connect. To remove the rest at
                once, delete this site&apos;s cookies: nothing kept on the
                server can be reached without them, and it is deleted eight days
                later.
              </li>
            </ul>
            <p>
              To limit abuse, the server counts requests for each visitor and
              each IP address over a minute or a day. The IP address is kept
              only as a hash.
            </p>
            <p>
              Each company keeps its own copy of the fictional customers for
              you, which starts again from the original data after a day without
              use, or sooner when many people use that company at once.
            </p>

            <h2 id="accounts">Agent accounts and passkeys</h2>
            <p>
              You can use the playground without an account. If you create one,
              you sign in to it with a passkey, and your conversations and
              connected companies follow you to every device you sign in on.
              There is no email or password, and nothing about you is asked for:
              the account is a random ID, an optional name you choose, its
              passkeys and its devices. A passkey&apos;s private key stays on
              your device; the account keeps only its public key, when it was
              added and last used, and the device&apos;s description.
            </p>
            <p>
              On this browser, a signed-in account is a cookie,{" "}
              <code>__Host-poppy_account</code>, that lasts 30 days from its
              last use. An app signed in to the account gets tokens instead,
              stored on the server only as hashes. A device&apos;s session ends
              after 30 days without use, and every session after a year. You can
              sign a device out, or every device, from Identity. An account not
              used for a year is deleted with its conversations.
            </p>

            <h2 id="model">Your model key and the model</h2>
            <p>
              If you use your own model key, it is saved in your browser&apos;s
              local storage on this device, with the model you chose. It is sent
              with each message to the server, which passes it to that
              model&apos;s provider for that request and does not store it. What
              you type, and what the companies answer, go to that provider to
              produce the reply. Standing instructions you set are kept in your
              browser too.
            </p>
            <p>
              The protocol demo, which needs no key, uses no model: fixed rules
              read what you type.
            </p>
            <p>
              A free model is coming, so the demo can use a model without a key
              of your own. When it arrives, the text you type to it will be sent
              to Cloudflare Workers AI to produce the reply.
            </p>

            <h2 id="analytics">Analytics</h2>
            {analytics ? (
              <p>
                The site uses Cloudflare Web Analytics, which sets no cookies
                and stores nothing in your browser. It counts page views and how
                fast pages load, with the page&apos;s address, the kind of
                browser and the country.
              </p>
            ) : (
              <p>
                The site uses no analytics. If it adds Cloudflare Web Analytics,
                which sets no cookies and stores nothing in your browser, this
                page will say so.
              </p>
            )}
            <p>
              The site runs on Cloudflare Workers, so Cloudflare handles every
              request as the host.
            </p>

            <h2 id="fictional">The companies are fictional</h2>
            <p>
              The five companies and everything they hold, from customers and
              orders to accounts, flights and bills, are made up. Please
              don&apos;t enter real passwords, card numbers or account details.
            </p>

            <h2 id="questions">Questions</h2>
            <p>
              If something here is unclear or doesn&apos;t match what you see,
              please <a href={FEEDBACK_URL}>open an issue on GitHub</a>.
            </p>
          </div>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}
