import { companyProfile, type DiscoveredCompany } from "@poppy-lab/pap-core";

const changeLabel = {
  none: "No changes",
  reversible: "Reversible changes",
  irreversible: "Irreversible changes",
} as const;

/** Company claims from discovery. Hints describe scopes; they never approve anything. */
export function CompanyProfileView({
  company,
}: {
  company: DiscoveredCompany;
}) {
  const profile = companyProfile(company);
  const signIn = [
    profile.signIn.direct && "Direct",
    profile.signIn.device && "Device",
  ].filter(Boolean);
  const scopes = [
    ...new Set([...profile.scopes, ...Object.keys(profile.scopeDescriptions)]),
  ];
  return (
    <section className="company-profile" aria-label="Company profile">
      <h2>Company profile</h2>
      <dl className="profile-facts">
        <div>
          <dt>Protocol</dt>
          <dd>Poppy {profile.version}</dd>
        </div>
        <div>
          <dt>Domain</dt>
          <dd>
            {company.document.organization.domain}
            <small className="privacy-note">
              {" "}
              Discovery proves this domain published the document, not that it
              belongs to “{company.document.organization.name}” (§10.3).
            </small>
          </dd>
        </div>
        <div>
          <dt>Identifier</dt>
          <dd>{profile.identifier}</dd>
        </div>
        <div>
          <dt>Sign-in</dt>
          <dd>
            {signIn.length ? signIn.join(" · ") : "Signed-out only"}
            {profile.pushedAuthorization
              ? ` · PAR ${profile.pushedAuthorization.required ? "required" : "offered"}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Extensions</dt>
          <dd>{profile.operations ? "Operations v3" : "None used"}</dd>
        </div>
      </dl>
      {profile.tasksEndpoint && (
        <>
          <h3>Tasks not offered</h3>
          <p className="privacy-note">
            Read at the start of each Session, with the Session header (§9):{" "}
            {profile.tasksEndpoint}
          </p>
        </>
      )}
      {!!scopes.length && (
        <>
          <h3>Scopes</h3>
          <ul className="scope-list">
            {scopes.map((scope) => {
              const hint = profile.scopeHints[scope];
              return (
                <li key={scope}>
                  <code>{scope}</code>
                  {profile.scopeDescriptions[scope] && (
                    <span>{profile.scopeDescriptions[scope]}</span>
                  )}
                  <small>
                    {hint
                      ? `${changeLabel[hint.changes]}${hint.personal_data ? " · personal data" : ""}`
                      : "No hints: treat as consequential"}
                  </small>
                </li>
              );
            })}
          </ul>
          <p className="privacy-note">
            Descriptions and hints are the Company&apos;s own claims. They help
            choose scopes; they never approve an action.
          </p>
        </>
      )}
    </section>
  );
}
