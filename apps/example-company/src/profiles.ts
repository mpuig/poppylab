import type { Req, Router } from "./router.js";
import type { Session } from "@poppy-lab/pap-company";
import type { Propose } from "./customer-services.js";
export type Profile = { name: string; email: string; address: string };
export type ProfileCustomer = { profile?: Profile; profile_version?: number };
export function profileState(c: ProfileCustomer) {
  c.profile ??= {
    name: "Alex Rivers",
    email: "alex@example.invalid",
    address: "Fictional Juniper demo address",
  };
  c.profile_version ??= 1;
  return {
    profile: structuredClone(c.profile),
    profile_version: c.profile_version,
  };
}
export class ProfileConflict extends Error {}
function validate(data: unknown): { version: number } & Profile {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("invalid_profile");
  const b = data as Record<string, unknown>;
  if (
    Object.keys(b).some(
      (k) => !["version", "name", "email", "address"].includes(k),
    ) ||
    !Number.isSafeInteger(b.version) ||
    Number(b.version) < 1
  )
    throw Error("invalid_profile");
  for (const [key, max] of [
    ["name", 80],
    ["email", 120],
    ["address", 240],
  ] as const)
    if (
      typeof b[key] !== "string" ||
      !b[key].trim() ||
      b[key].length > max ||
      [...b[key]].some(
        (ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127,
      )
    )
      throw Error("invalid_profile");
  const email = String(b.email).trim().toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.invalid$/.test(
      email,
    )
  )
    throw Error("fictional_email_required");
  return {
    version: Number(b.version),
    name: String(b.name).trim(),
    email,
    address: String(b.address).trim(),
  };
}
export function profiles(
  app: Router,
  sessionFor: (r: Req) => Session,
  customer: (s: Session) => ProfileCustomer,
  propose: Propose,
) {
  function checked(s: Session, data: unknown) {
    const { version, ...after } = validate(data),
      before = profileState(customer(s));
    if (version !== before.profile_version) throw new ProfileConflict();
    return { ...before, after };
  }
  app.post("/api/account/profile-proposal", async (req, reply) => {
    try {
      const s = sessionFor(req),
        v = checked(s, req.body);
      return propose(
        req,
        reply,
        s,
        {
          kind: "profile_change",
          profile_version: v.profile_version,
          before_profile: v.profile,
          after_profile: v.after,
        },
        `Change the fictional profile (version ${v.profile_version}): name “${v.profile.name}” → “${v.after.name}”; email “${v.profile.email}” → “${v.after.email}”; address “${v.profile.address}” → “${v.after.address}”. Only future purchases use it; existing orders don't change. Needs your approval.`,
      );
    } catch (e) {
      return reply.code(e instanceof ProfileConflict ? 409 : 400).send({
        error:
          e instanceof ProfileConflict
            ? "profile_changed"
            : "invalid_fictional_profile",
      });
    }
  });
  return {
    updateProfile(s: Session, data: unknown) {
      const v = checked(s, data),
        c = customer(s);
      c.profile = v.after;
      c.profile_version = v.profile_version + 1;
      return profileState(c);
    },
    stale(s: Session, t: Record<string, unknown>) {
      return profileState(customer(s)).profile_version !== t.profile_version;
    },
    apply(s: Session, t: Record<string, unknown>) {
      const c = customer(s);
      c.profile = structuredClone(t.after_profile) as Profile;
      c.profile_version = Number(t.profile_version) + 1;
      return {
        summary:
          "Fictional profile updated. Only future purchases will use it; existing orders haven't changed.",
        data: profileState(c),
      };
    },
  };
}
