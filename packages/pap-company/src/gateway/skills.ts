/**
 * §9.4 agent context: the skills a Company publishes for Personal Agents.
 * Each is one `SKILL.md` in the Agent Skills format, served from the
 * Company's own origin, and listed in the tasks response's `skill_index`
 * in the form of the Agent Skills discovery proposal the spec pins.
 *
 * The index's `digest` is the SHA-256 of the very bytes the artifact route
 * serves, computed here when the Company starts, so the two can't disagree.
 */
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { escapeHtml } from "../html.ts";
import type { SkillDefinition } from "./types.ts";

/** The pinned proposal's schema identifier: opaque, never fetched. */
export const SKILL_INDEX_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
/**
 * Where artifacts live, next to `/poppy/tasks`. Index entries give the path
 * from the origin, which resolves to the same URL against `tasks.endpoint`
 * (§9.4) at every deployment, the local plain-HTTP ones included.
 */
const SKILLS_PATH = "/poppy/skills";
/** The path of a skill's file from the Company's origin. */
const skillPath = (name: string) => `${SKILLS_PATH}/${name}/SKILL.md`;
/** The Agent Skills format's limits on a skill's name and description. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SkillIndex = {
  $schema: string;
  skills: Array<{
    name: string;
    description: string;
    type: "skill-md";
    url: string;
    digest: string;
  }>;
};

/**
 * The `SKILL.md` of a skill: the frontmatter the format requires, written
 * from the same name and description the index lists, then the body. The
 * description is a JSON string, which YAML reads as a quoted scalar.
 */
const skillFile = ({ name, description, body }: SkillDefinition) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;

/**
 * The same skills as table rows for a Company's page for agents: each name
 * links to its file, beside the description the index gives. Written from
 * the definitions the gateway serves, so the page can't say something else.
 */
export const skillRowsHtml = (skills: readonly SkillDefinition[]) =>
  skills
    .map(
      ({ name, description }) =>
        `<tr><th scope="row"><a href="${escapeHtml(skillPath(name))}"><code>${escapeHtml(name)}</code></a></th><td>${escapeHtml(description.trim())}</td></tr>`,
    )
    .join("");

/**
 * Serves each skill's `SKILL.md` and returns the index for the tasks
 * response, or nothing for a Company that publishes no skills. `headers`
 * are the caching headers of the tasks response: an index and the artifacts
 * it names then age together.
 */
export function mountSkills(
  app: Hono,
  skills: readonly SkillDefinition[] | undefined,
  headers: Record<string, string>,
): SkillIndex | undefined {
  if (!skills?.length) return undefined;
  const artifacts = new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; digest: string }
  >();
  for (const skill of skills) {
    const description = skill.description.trim();
    if (
      skill.name.length > 64 ||
      !NAME.test(skill.name) ||
      artifacts.has(skill.name) ||
      !description ||
      description.length > 1024 ||
      /[\r\n]/.test(description) ||
      !skill.body.trim()
    )
      throw new Error(`Invalid skill definition: ${skill.name}`);
    // A copy over its own buffer, which is what a response body takes.
    const bytes = new Uint8Array(
      new TextEncoder().encode(skillFile({ ...skill, description })),
    );
    artifacts.set(skill.name, {
      bytes,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
  }
  // Public like the tasks response: no Session header and no token. Hono
  // answers HEAD from the same route, and any other name gets its 404.
  app.get(`${SKILLS_PATH}/:name/SKILL.md`, (c) => {
    const artifact = artifacts.get(c.req.param("name"));
    if (!artifact) return c.notFound();
    return c.body(artifact.bytes, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      ...headers,
    });
  });
  return {
    $schema: SKILL_INDEX_SCHEMA,
    skills: skills.map(({ name, description }) => ({
      name,
      description: description.trim(),
      type: "skill-md",
      url: skillPath(name),
      digest: artifacts.get(name)!.digest,
    })),
  };
}
