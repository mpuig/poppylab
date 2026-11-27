/**
 * The domain extensions a User can turn on for one conversation: a
 * standard-shaped, read-only API next to the Company's own, used through a
 * native adapter (`poppylab.dev/fdx` at a bank, `poppylab.dev/espi` at an
 * electricity utility). One control, "Use FDX" or "Use ESPI", for whichever
 * the Company lists. Plain data, for the page and the server alike.
 */
import {
  ESPI_EXTENSION,
  FDX_EXTENSION,
  type CompanyProfile,
} from "@poppy-lab/pap-core";

export type DomainExtension = {
  /** The connection's flag and the account action that sets it. */
  key: "fdx" | "espi";
  name: typeof FDX_EXTENSION | typeof ESPI_EXTENSION;
  /** "Use FDX", "Use ESPI". */
  label: "FDX" | "ESPI";
  shape: "FDX-shaped" | "ESPI-shaped";
  /** Its scopes start with this. */
  prefix: "fdx:" | "espi:";
  /**
   * The scopes its tools use, asked for at sign-in with it on. Without a
   * list, every scope with the prefix that the Company hints changes nothing.
   */
  scopes?: readonly string[];
};

export const DOMAIN_EXTENSIONS: readonly DomainExtension[] = [
  {
    key: "fdx",
    name: FDX_EXTENSION,
    label: "FDX",
    shape: "FDX-shaped",
    prefix: "fdx:",
  },
  {
    key: "espi",
    name: ESPI_EXTENSION,
    label: "ESPI",
    shape: "ESPI-shaped",
    prefix: "espi:",
    // espi:customer (name and address) has no tool: never asked for.
    scopes: ["espi:usage", "espi:summary"],
  },
];

/** The domain extension a Company lists, valid, if any (the first). */
export const domainExtension = (
  profile: Pick<CompanyProfile, "extensions"> | undefined,
) => DOMAIN_EXTENSIONS.find((e) => !!profile?.extensions?.[e.name]);

export const extensionByKey = (key: unknown) =>
  DOMAIN_EXTENSIONS.find((e) => e.key === key);

/** The domain extension a scope belongs to. */
export const extensionOfScope = (scope: string) =>
  DOMAIN_EXTENSIONS.find((e) => scope.startsWith(e.prefix));

/** Whether a sign-in with the extension on asks for this scope of it. */
export const asksFor = (extension: DomainExtension, scope: string) =>
  scope.startsWith(extension.prefix) &&
  (!extension.scopes || extension.scopes.includes(scope));

/**
 * Which domain extensions a connection has on and its Company lists: what the
 * Session declares and the sign-in asks scopes for. A profile saved before
 * profiles kept extensions lists none.
 */
export function extensionsOn(connection: {
  fdx?: boolean;
  espi?: boolean;
  company?: { profile?: Pick<CompanyProfile, "extensions"> };
}): Partial<Record<DomainExtension["key"], boolean>> {
  return Object.fromEntries(
    DOMAIN_EXTENSIONS.filter(
      (e) =>
        connection[e.key] &&
        !!connection.company?.profile?.extensions?.[e.name],
    ).map((e) => [e.key, true]),
  );
}
