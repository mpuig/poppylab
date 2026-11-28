import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { discovered } from "@poppy-lab/pap-agent/testing";
import { AskBlock } from "./ask-block";
import type { Ask } from "./asks";
import { harborlineUrl, lanternUrl } from "./companies";
import { companyFromView, type CompanyState } from "./company-state";
import type { Playground } from "./use-playground";

const lantern = new URL(lanternUrl).origin;
const harborline = new URL(harborlineUrl).origin;

const companyAt = (
  origin: string,
  name: string,
  more: Partial<CompanyState> = {},
): CompanyState => ({
  ...companyFromView({ origin, name, company: discovered(origin, name) }),
  ...more,
});

function findButton(
  node: ReactNode,
): ReactElement<{ onClick?: () => void }> | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (node.type === "button")
    return node as ReactElement<{ onClick?: () => void }>;
  return findButton((node.props as { children?: ReactNode }).children);
}

describe("AskBlock underway sign-in retry", () => {
  it("reuses the requested write access when reopening a sign-in started outside a write ask", () => {
    const accountAction = vi.fn();
    const p = {
      busy: false,
      language: "en",
      accountAction,
    } as unknown as Playground;
    const c = companyAt(lantern, "Lantern Noodle Bar", {
      signingIn: { baseline: 1, since: 0, access: "write" },
    });
    const ask: Ask = {
      key: `ask signing ${lantern}`,
      kind: "signing",
      origin: lantern,
      phase: "underway",
    };

    const button = findButton(AskBlock({ ask, c, p, named: false }));
    expect(button).toBeDefined();
    button!.props.onClick?.();

    expect(accountAction).toHaveBeenCalledWith(
      "signin",
      lantern,
      undefined,
      "write",
    );
  });

  it("reuses write access when reopening an extension sign-in that requested write", () => {
    const accountAction = vi.fn();
    const p = {
      busy: false,
      language: "en",
      accountAction,
    } as unknown as Playground;
    const c = companyAt(harborline, "Harborline Bank", {
      signedIn: true,
      signingIn: { baseline: 2, since: 0, access: "write" },
    });
    const ask: Ask = {
      key: `ask extension ${harborline}`,
      kind: "extension",
      origin: harborline,
      phase: "underway",
    };

    const button = findButton(AskBlock({ ask, c, p, named: false }));
    button!.props.onClick?.();

    expect(accountAction).toHaveBeenCalledWith(
      "signin",
      harborline,
      undefined,
      "write",
    );
  });

  it("reuses read access when reopening a read-only sign-in", () => {
    const accountAction = vi.fn();
    const p = {
      busy: false,
      language: "en",
      accountAction,
    } as unknown as Playground;
    const c = companyAt(lantern, "Lantern Noodle Bar", {
      signingIn: { baseline: 0, since: 0, access: "read" },
    });
    const ask: Ask = {
      key: `ask signin ${lantern}`,
      kind: "signin",
      origin: lantern,
      phase: "underway",
    };

    const button = findButton(AskBlock({ ask, c, p, named: false }));
    button!.props.onClick?.();

    expect(accountAction).toHaveBeenCalledWith(
      "signin",
      lantern,
      undefined,
      "read",
    );
  });
});
