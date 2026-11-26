/**
 * TEST ONLY. For a Company's own tests of what the gateway gives it: the
 * Company on the gateway with a Personal Agent's keys (`setup`, with the
 * Company's definition as its second argument), a browser that keeps its
 * cookies, and the steps of a browser join (§6). Never imported by code
 * that ships: it needs vitest.
 */
export { client, origin, redirect, setup } from "./gateway/test-company.ts";
export * from "./gateway/test-browser.ts";
export * from "./gateway/test-join-suite.ts";
