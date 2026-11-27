/**
 * Text for an HTML page, as every page of the lab, of a Company and of its
 * gateway writes it: the five characters that could end an element or an
 * attribute become numeric references, in text and in quoted attribute
 * values alike. Here, at the bottom of the packages, so pap-core's own
 * pages and pap-company (through pap-client) use this one.
 */
export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
