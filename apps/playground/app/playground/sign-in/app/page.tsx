import type { Metadata } from "next";
import { AppSignInResult } from "./app-result";

/**
 * Where a sign-in started from a client app ends, done or not
 * (`APP_SIGN_IN_END` in `@poppy-lab/pap-agent/sign-in-cookie`): the one
 * address the app's browser watches for. The callback has spent the
 * one-time code by then, so the address carries only the outcome and the
 * lab's key for the Company. The app learns how it went from the
 * conversation; this page is for a person whose browser stayed open.
 */
export const metadata: Metadata = { title: "Sign-in · Poppy Lab" };

export default function AppSignIn() {
  return (
    <div className="app">
      <header className="site-header">
        <a href="/" className="brand">
          Poppy Lab
        </a>
      </header>
      <main>
        <AppSignInResult />
      </main>
    </div>
  );
}
