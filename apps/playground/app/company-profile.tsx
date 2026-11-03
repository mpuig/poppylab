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
          <dd>PAP {profile.version}</dd>
        </div>
        <div>
          <dt>Identifier</dt>
          <dd>{profile.identifier}</dd>
        </div>
        <div>
          <dt>Sign-in</dt>
          <dd>{signIn.length ? signIn.join(" · ") : "Signed-out only"}</dd>
        </div>
      </dl>
      {profile.excludedTasksUrl && (
        <>
          <h3>Not offered through PAP</h3>
          {company.excludedTasksError ? (
            <p className="privacy-note">{company.excludedTasksError}</p>
          ) : company.excludedTasks?.length ? (
            <ul className="scope-list">
              {company.excludedTasks.map((item, index) => (
                <li key={index}>
                  <strong>{item.task}</strong>
                  {item.alternative?.instructions && (
                    <span>{item.alternative.instructions}</span>
                  )}
                  {item.alternative?.references.map((ref, i) => (
                    <small key={i}>
                      {ref.type === "web"
                        ? ref.url
                        : ref.type === "openapi"
                          ? `OpenAPI · ${ref.operation_id}`
                          : `MCP tool · ${ref.tool}`}
                    </small>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="privacy-note">The Company lists no excluded tasks.</p>
          )}
          <p className="privacy-note">Source: {profile.excludedTasksUrl}</p>
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
