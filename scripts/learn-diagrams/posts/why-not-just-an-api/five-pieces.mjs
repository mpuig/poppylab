import { compare } from "../../draw.mjs";

/**
 * A partner API and the same API under Poppy (the fifth post): the five
 * pieces an ordinary REST API with OAuth leaves out when an agent arrives
 * with nothing but the company's domain.
 */
const spec = {
  heads: ["A partner API", "With Poppy"],
  rows: [
    {
      head: "Finding you",
      without: "a developer reads your docs and copies your URLs",
      with: "one poppy.json on your domain lists every interface, scope and scope hint",
    },
    {
      head: "Who is calling",
      without: "a client ID and secret issued in your portal",
      with: "a client_id that is an HTTPS URL hosting the agent's keys, with no registration",
    },
    {
      head: "Before and after sign-in",
      without: "anonymous requests until a login",
      with: "a Session from the first request; consent on your own page, revocable agent by agent",
    },
    {
      head: "Changes",
      without: "trusts that the caller's screen showed the real price",
      with: "approval_required with your exact terms; runs once, and only for that revision",
    },
    {
      head: "What you don't offer",
      without: "a 404, or a workaround the agent guesses",
      with: "/poppy/tasks lists it with an alternative; /poppy/feedback reports the gap",
    },
  ],
};

export default {
  name: "five-pieces",
  alt: "A comparison of a partner API with the same API under Poppy, in five rows. Finding you: with a partner API a developer reads your docs and copies your URLs; with Poppy one poppy.json on your domain lists every interface, scope and scope hint. Who is calling: a client ID and secret issued in your portal, against a client_id that is an HTTPS URL hosting the agent's keys, with no registration. Before and after sign-in: anonymous requests until a login, against a Session from the first request, with consent on your own page that can be revoked agent by agent. Changes: the partner API trusts that the caller's screen showed the real price; with Poppy the first request returns approval_required with your exact terms, and the change runs once, only for that revision. What you don't offer: a 404 or a workaround the agent guesses, against /poppy/tasks listing it with an alternative and /poppy/feedback reporting the gap.",
  caption:
    "Five things a partner API leaves to a developer who reads the docs, and that Poppy gives an agent arriving with only a domain.",
  draw: (variant) => compare(spec, variant),
};
