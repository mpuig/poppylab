/**
 * The requests and answers /developers/native-client shows, in the shapes
 * of real ones (taken from the API's own tests, with production's hosts).
 * Each names its operation by ID, so the page reads its method and path
 * from the document, and `api-reference.test.ts` holds every body to that
 * operation's schemas: an example the document no longer describes fails
 * the build's tests instead of misleading a reader.
 */
export type ApiExample = {
  operation: string;
  /** Values for the path's parameters, by name. */
  path?: Record<string, string>;
  /** Headers to show on the request, beyond `Content-Type`. */
  headers?: Record<string, string>;
  request?: unknown;
  status: number;
  response?: unknown;
  /** The answer as text, for one that isn't JSON (the event stream). */
  text?: string;
};

const ACCOUNT = "c0rOAOzr0jtlGGeGpluvjQ";
const SESSION = "nsDf4rxOjzq3NFKVJdG2AQ";
const ACCESS = `poppy_at.${ACCOUNT}.${SESSION}.KNGQT617OSA3c-i9As0a4HxastNzn0rb3CX977GSDSo`;
const BEARER = { Authorization: `Bearer ${ACCESS}` };
const CONVERSATION = "hKhgaC-veINpeBH3fJQO4-ewBMbIdw9j";
const LANTERN = {
  origin: "https://food-demo.poppylab.dev",
  name: "Lantern Noodle Bar",
};

const lantern = (signedIn: boolean) => ({
  ...LANTERN,
  url: `${LANTERN.origin}/`,
  signedIn,
  ...(signedIn ? { scopes: "orders:read orders:write" } : {}),
  signingIn: false,
  consentVersion: signedIn ? 1 : 0,
  accessLost: false,
  direct: { open: false, invitation: null },
});

const proposal = {
  id: "op_4UNgDhnV1Y8lgsDmZCAV2pt3",
  company: LANTERN,
  revision: "1795772788-peanO34panWBIb-5",
  summary:
    "Change order ord_LNB1001 for Elena Maren. Delivery stays Friday 18:30–19:00. New dishes: 2 × Shoyu ramen, 1 × Salted edamame, 1 × Matcha ice cream. New total USD 43.00 (was USD 37.00; USD 6.00 more, charged — simulated, no real payment).",
  terms: {
    order_id: "ord_LNB1001",
    order_version: 1,
    lines: { "shoyu-ramen": 2, edamame: 1, "matcha-ice": 1 },
    before_total_cents: 3700,
    new_total_cents: 4300,
    currency: "USD",
  },
  state: "proposed",
  expiresAt: "2026-11-27T09:56:28.685Z",
};

const tokens = {
  session: SESSION,
  accessToken: ACCESS,
  accessTokenExpiresAt: 1795773688698,
  refreshToken: `poppy_rt.${ACCOUNT}.${SESSION}.65P8qaJ8Pl2zhzDf8eD1JXRCBGpxYiJhI3aokMn9hhE`,
  refreshTokenExpiresAt: 1798364788698,
};

const account = {
  id: ACCOUNT,
  label: "Home",
  created: 1795772788698,
  passkeys: [
    {
      id: "dwA7sfRJQDk5IN4eJgtesA",
      name: "iPhone",
      created: 1795772788698,
      synced: true,
    },
  ],
  channels: [],
  session: SESSION,
};

export const EXAMPLES = {
  accountOptions: {
    operation: "accountOptions",
    request: { label: "Home" },
    status: 200,
    response: {
      ceremony: "DMz80NY0PzjiwanwGamYKA",
      options: {
        challenge: "U3l0bkxYSjE4cU9jT2xqVDFPaTNTMUpRbXM2RTdVdU04andPa3d1cC1kbw",
        rp: { name: "poppylab.dev", id: "poppylab.dev" },
        user: { id: ACCOUNT, name: "Home", displayName: "Home" },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        timeout: 300000,
        attestation: "none",
        excludeCredentials: [],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
          requireResidentKey: true,
        },
        extensions: { credProps: true },
        hints: [],
      },
    },
  },
  createAccount: {
    operation: "createAccount",
    request: {
      ceremony: "DMz80NY0PzjiwanwGamYKA",
      credential: {
        id: "dwA7sfRJQDk5IN4eJgtesA",
        rawId: "dwA7sfRJQDk5IN4eJgtesA",
        type: "public-key",
        response: {
          clientDataJSON:
            "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoi…",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViU…",
          transports: ["internal", "hybrid"],
        },
        clientExtensionResults: {},
      },
      device: "iPhone",
    },
    status: 201,
    response: { account, tokens },
  },
  signInOptions: {
    operation: "signInOptions",
    request: {},
    status: 200,
    response: {
      ceremony: "wCo3tWEijhywKSPwr2Ko-g",
      options: {
        rpId: "poppylab.dev",
        challenge: "SEROTUthMEJBYzQ0Qy10aWNhc2Z5OFBkMElHcjB5VGpBOHVaaGtwZlozZw",
        timeout: 300000,
        userVerification: "required",
      },
    },
  },
  signIn: {
    operation: "signIn",
    request: {
      ceremony: "wCo3tWEijhywKSPwr2Ko-g",
      credential: {
        id: "dwA7sfRJQDk5IN4eJgtesA",
        rawId: "dwA7sfRJQDk5IN4eJgtesA",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoi…",
          authenticatorData:
            "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
          signature: "MEUCIQDMwoQt0_I1bv5nZsegi8Rr5lxSIXVLj5vKbUN5x3Du_QIg…",
          userHandle: ACCOUNT,
        },
        clientExtensionResults: {},
      },
      device: "iPad",
    },
    status: 201,
    response: { account, tokens },
  },
  refreshSession: {
    operation: "refreshSession",
    request: { refreshToken: tokens.refreshToken },
    status: 200,
    response: {
      ...tokens,
      accessToken: `poppy_at.${ACCOUNT}.${SESSION}.naUO0cj7F9IBYr8d8ezzoJiKRwUtyk5VVmN5V1BHADk`,
      accessTokenExpiresAt: 1795774588698,
      refreshToken: `poppy_rt.${ACCOUNT}.${SESSION}.bo44NTfc5jOxs2-yDukmbRzcI2rgfPBV8j9g8y9FzRc`,
    },
  },
  refreshReused: {
    operation: "refreshSession",
    request: { refreshToken: tokens.refreshToken },
    status: 401,
    response: {
      code: "session_revoked",
      error:
        "This refresh token was used before, so the session was ended on every device that had it. Sign in again with your passkey.",
    },
  },
  startConversation: {
    operation: "startConversation",
    headers: BEARER,
    request: { company: LANTERN.origin },
    status: 201,
    response: {
      id: CONVERSATION,
      active: true,
      companies: [lantern(false)],
      removed: [],
      messages: [],
      proposals: [],
    },
  },
  sendMessage: {
    operation: "sendMessage",
    path: { id: CONVERSATION },
    headers: BEARER,
    request: { text: "What can you do?" },
    status: 200,
    response: {
      conversation: CONVERSATION,
      messages: [
        { from: "user", text: "What can you do?" },
        {
          from: "agent",
          text: "Demo mode runs the examples below, without a model. To ask anything in your own words, press “Use your own model”.",
          choices: [
            {
              label: "What’s on the menu?",
              answer: { message: "What’s on the menu?" },
            },
          ],
        },
      ],
      replaced: false,
      state: {
        id: CONVERSATION,
        active: true,
        companies: [lantern(false)],
        removed: [],
        messages: ["…"],
        proposals: [],
      },
    },
  },
  answerChoice: {
    operation: "answerChoice",
    path: { id: CONVERSATION },
    headers: BEARER,
    request: { answer: { message: "What’s on the menu?" } },
    status: 200,
  },
  startSignIn: {
    operation: "startSignIn",
    path: { id: CONVERSATION },
    headers: BEARER,
    request: { company: LANTERN.origin, access: "write" },
    status: 200,
    response: {
      url: "https://poppylab.dev/api/v1/sign-ins/Wq3v0mA4…",
      expiresAt: 1795772968698,
      endUrl: "https://poppylab.dev/playground/sign-in/app",
    },
  },
  decideProposal: {
    operation: "decideProposal",
    path: { id: CONVERSATION, proposal: proposal.id },
    headers: BEARER,
    request: {
      company: LANTERN.origin,
      revision: proposal.revision,
      decision: "approve",
    },
    status: 200,
    response: {
      proposal: { ...proposal, state: "succeeded" },
      state: {
        id: CONVERSATION,
        active: true,
        companies: [lantern(true)],
        removed: [],
        messages: ["…"],
        proposals: ["…"],
      },
    },
  },
  conversationEvents: {
    operation: "conversationEvents",
    path: { id: CONVERSATION },
    headers: { ...BEARER, Accept: "text/event-stream" },
    status: 200,
    text: `retry: 3000

event: state
data: {"type":"state","state":{"id":"${CONVERSATION}","active":true,…}}

: read

event: signin.completed
data: {"type":"signin.completed","company":{"origin":"${LANTERN.origin}","name":"${LANTERN.name}"}}

event: proposal.created
data: {"type":"proposal.created","proposal":{"id":"${proposal.id}",…}}`,
  },
  signOut: {
    operation: "signOut",
    headers: BEARER,
    request: {},
    status: 200,
    response: { revoked: 1 },
  },
} satisfies Record<string, ApiExample>;
