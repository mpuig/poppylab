import {
  BROWSER_SIGN_IN,
  companyProfile,
  type DiscoveredCompany,
} from "@poppy-lab/pap-core";
import type { ShownSkill, ShownTask } from "@/lib/shown-tasks";
import { SpecRef } from "./spec-ref";

const changeLabel = {
  none: "No changes",
  reversible: "Reversible changes",
  irreversible: "Irreversible changes",
} as const;

/**
 * Company claims from discovery. Hints describe scopes; they never approve
 * anything. The tasks the Company doesn't offer and the skills it publishes
 * aren't in discovery: a Session reads them, so they are listed only once
 * the page has them.
 */
export function CompanyProfileView({
  company,
  excludedTasks,
  skills,
}: {
  company: DiscoveredCompany;
  excludedTasks?: ShownTask[];
  skills?: ShownSkill[];
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
      {!!skills?.length && (
        <>
          <h3>Skills published</h3>
          <ul className="scope-list">
            {skills.map((skill, index) => (
              <li key={index}>
                <code>
                  <a href={skill.url} target="_blank" rel="noopener noreferrer">
                    {skill.name}
                  </a>
                </code>
                <span>{skill.description}</span>
                <small>Served by {skill.host}</small>
              </li>
            ))}
          </ul>
          <p className="privacy-note">
            The Company&apos;s own list of how to do tasks it supports, as this
            conversation&apos;s Session read it (<SpecRef reference="§9.4" />
            ). Each name opens the skill&apos;s file. Iris doesn&apos;t load
            skills yet, so nothing in them reaches the model.
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
                    {scope === BROWSER_SIGN_IN &&
                      " · Iris has no browser, so it doesn't ask for this"}
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
