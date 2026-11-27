"use client";
import { useEffect, useState } from "react";
import { appSignInResult } from "./result";

/**
 * The heading and sentence of the page an app's sign-in ends on, read
 * from the address once the browser has loaded it. An app usually closes
 * its browser as soon as it reaches this address, so the page is seen
 * only by a person whose app didn't.
 */
export function AppSignInResult() {
  const [shown, setShown] = useState(() => appSignInResult(""));
  useEffect(() => {
    setShown(appSignInResult(window.location.search));
  }, []);
  return (
    <section className="intro">
      <h1>{shown.title}</h1>
      <p role="status">{shown.text}</p>
    </section>
  );
}
