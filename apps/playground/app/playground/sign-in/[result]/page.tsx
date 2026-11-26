import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloseTab } from "../close-tab";
import { signedInText } from "../company";
import { SignedIn } from "../signed-in";

/**
 * Where the sign-in tab lands after the Company sent it back
 * (`/api/account/callback`): the callback spends the one-time code and
 * leaves for this address, which carries nothing from it. Each outcome is a
 * fixed word in the address with fixed text here; nothing is read from a
 * query. The playground tab learns of the sign-in by asking the server.
 *
 * A completed sign-in names its Company once the browser has loaded the
 * page: the playground tab left the name in this browser (`../company`).
 */
const results: Record<string, { title: string; text: string }> = {
  done: {
    title: "Signed in.",
    text: signedInText(undefined),
  },
  failed: {
    title: "Sign-in not completed.",
    text: "Sign-in failed or was declined. Close this tab and retry Sign in in the playground.",
  },
};

// Only these two exist.
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(results).map((result) => ({ result }));
}

export const metadata: Metadata = { title: "Sign-in · Poppy Lab" };

export default async function SignInResult({
  params,
}: {
  params: Promise<{ result: string }>;
}) {
  const { result } = await params;
  const outcome = Object.hasOwn(results, result) ? results[result] : undefined;
  if (!outcome) notFound();
  return (
    <div className="app">
      <header className="site-header">
        <a href="/" className="brand">
          Poppy Lab
        </a>
      </header>
      <main>
        <section className="intro">
          <h1>{outcome.title}</h1>
          {result === "done" ? (
            <SignedIn />
          ) : (
            <p role="status">{outcome.text}</p>
          )}
        </section>
        <div className="list-actions">
          <CloseTab />
        </div>
      </main>
    </div>
  );
}
