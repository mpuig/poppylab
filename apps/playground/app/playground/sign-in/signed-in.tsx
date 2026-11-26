"use client";
import { useEffect, useState } from "react";
import { signedInText, takeSignInCompany } from "./company";

/**
 * The sentence of the page a completed sign-in lands on. It names the
 * Company once the browser has told it which one the playground started
 * the sign-in at; until then, and when the browser doesn't know, it says
 * "the Company account". The name is text, never markup.
 */
export function SignedIn() {
  const [company, setCompany] = useState<string>();
  useEffect(() => {
    const name = takeSignInCompany();
    if (name) setCompany(name);
  }, []);
  return <p role="status">{signedInText(company)}</p>;
}
