import { specRefParts } from "@poppy-lab/pap-core";

/** What every link into the protocol's published text carries. */
export const specLink = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

/**
 * A reference to the published text as the lab writes it ("§5.2",
 * "§3.4, §5.2–5.3", "Operations §4–6"). Each section number is a link to
 * that section, and opens in a new tab.
 */
export function SpecRef({
  reference,
  className,
}: {
  reference: string;
  className?: string;
}) {
  if (!reference) return null;
  return (
    <span className={className}>
      {specRefParts(reference).map((part, index) =>
        part.href ? (
          <a key={index} href={part.href} {...specLink}>
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}
