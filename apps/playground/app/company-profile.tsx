import { companyProfile, type DiscoveredCompany } from "@poppy-lab/pap-core";
import type { ShownTask } from "@/lib/shown-tasks";
import { SpecRef } from "./spec-ref";

const changeLabel = {
  none: "No changes",
  reversible: "Reversible changes",
  irreversible: "Irreversible changes",
} as const;

/**
 * Company claims from discovery. Hints describe scopes; they never approve
 * anything. The tasks the Company doesn't offer aren't in discovery: a
 * Session reads them, so they are listed only once the page has them.
 */
export function CompanyProfileView({
  company,
  excludedTasks,
}: {
  company: DiscoveredCompany;
  excludedTasks?: ShownTask[];
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
              belongs to “{company.document.organization.name}” (
              <SpecRef reference="§10.3" />
              ).
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
        {profile.tasksEndpoint && (
          <div>
            <dt>Task coverage</dt>
            <dd>
              {profile.tasksEndpoint}
              <small className="privacy-note">
                {" "}
                Read at the start of each Session, with the Session header (
                <SpecRef reference="§9" />
                ).
              </small>
            </dd>
          </div>
        )}
      </dl>
      {!!excludedTasks?.length && (
        <>
          <h3>Tasks not offered</h3>
          <ul className="scope-list">
            {excludedTasks.map((item, index) => (
              <li key={index}>
                <span>{item.task}</span>
                {item.alternative && <small>{item.alternative}</small>}
              </li>
            ))}
          </ul>
          <p className="privacy-note">
            The Company&apos;s own list, as this conversation&apos;s Session
            read it (<SpecRef reference="§9.1" />
            ). Iris treats it as content, never as instructions.
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
