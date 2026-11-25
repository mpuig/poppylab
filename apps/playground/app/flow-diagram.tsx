/**
 * Who talks to whom: you, your agent and the company. Three nodes and four
 * connectors on a 4px grid, with amber only on the two things the person
 * does themselves. Below 720px the upright drawing takes its place.
 */
export function FlowDiagram() {
  return (
    <figure className="flow">
      <svg
        className="wide"
        viewBox="0 0 1120 288"
        role="img"
        aria-label="You ask your agent. Your agent sends signed requests to the company, which holds any change. You sign in on the company's own page, not through the agent, and you approve the exact change in your agent."
      >
        <defs>
          <marker
            id="flow-head"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path className="head" d="M0 0L10 5L0 10z" />
          </marker>
        </defs>

        {/* 2: sign-in goes from you to the company, over the agent. */}
        <path
          className="wire"
          d="M120 112V56a8 8 0 0 1 8-8H992a8 8 0 0 1 8 8V108"
          markerEnd="url(#flow-head)"
        />
        {/* 3: approval goes from you into your agent. */}
        <path
          className="wire"
          d="M120 192V248a8 8 0 0 0 8 8H552a8 8 0 0 0 8-8V196"
          markerEnd="url(#flow-head)"
        />
        {/* 1: the request. */}
        <path className="wire" d="M240 152H436" markerEnd="url(#flow-head)" />
        {/* Agent and company. */}
        <path className="wire" d="M680 140H876" markerEnd="url(#flow-head)" />
        <path
          className="wire back"
          d="M880 164H684"
          markerEnd="url(#flow-head)"
        />

        <rect
          className="node you"
          x="0"
          y="112"
          width="240"
          height="80"
          rx="6"
        />
        <text className="t-name on-ink" x="20" y="146">
          You
        </text>
        <text className="t-sub on-ink" x="20" y="170">
          the customer
        </text>

        <rect className="node" x="440" y="112" width="240" height="80" rx="6" />
        <text className="t-name" x="460" y="146">
          Your agent
        </text>
        <text className="t-sub" x="460" y="170">
          Iris, in this lab
        </text>

        <rect
          className="node company"
          x="880"
          y="112"
          width="240"
          height="80"
          rx="6"
        />
        <text className="t-name" x="900" y="146">
          The company
        </text>
        <text className="t-sub" x="900" y="170">
          Juniper Market, in this lab
        </text>

        <text className="t-label" x="340" y="140" textAnchor="middle">
          1 · You ask
        </text>
        <text className="t-label" x="780" y="128" textAnchor="middle">
          signed requests
        </text>
        <text className="t-label" x="780" y="188" textAnchor="middle">
          changes held for approval
        </text>

        <rect className="tag" x="368" y="32" width="384" height="32" rx="4" />
        <text className="t-tag" x="560" y="53" textAnchor="middle">
          2 · You sign in on the company&apos;s own page
        </text>
        <rect className="tag" x="196" y="240" width="288" height="32" rx="4" />
        <text className="t-tag" x="340" y="261" textAnchor="middle">
          3 · You approve the exact change
        </text>
      </svg>

      {/* The same drawing turned upright for narrow screens. */}
      <svg
        className="narrow"
        viewBox="-1 -1 362 410"
        role="img"
        aria-label="You ask your agent. Your agent sends signed requests to the company, which holds any change. You sign in on the company's own page, not through the agent, and you approve the exact change in your agent."
      >
        <defs>
          <marker
            id="flow-head-narrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path className="head" d="M0 0L10 5L0 10z" />
          </marker>
        </defs>

        {/* 2: sign-in runs down the side, past the agent. */}
        <path
          className="wire"
          d="M232 36H292a8 8 0 0 1 8 8V364a8 8 0 0 1-8 8H236"
          markerEnd="url(#flow-head-narrow)"
        />
        {/* 1 and 3: the request and the approval go into your agent. */}
        <path
          className="wire"
          d="M24 72V164"
          markerEnd="url(#flow-head-narrow)"
        />
        <path
          className="wire"
          d="M124 72V164"
          markerEnd="url(#flow-head-narrow)"
        />
        {/* Agent and company. */}
        <path
          className="wire"
          d="M24 240V332"
          markerEnd="url(#flow-head-narrow)"
        />
        <path
          className="wire back"
          d="M148 336V244"
          markerEnd="url(#flow-head-narrow)"
        />

        <rect className="node you" x="0" y="0" width="232" height="72" rx="6" />
        <text className="t-name on-ink" x="20" y="32">
          You
        </text>
        <text className="t-sub on-ink" x="20" y="54">
          the customer
        </text>

        <rect className="node" x="0" y="168" width="232" height="72" rx="6" />
        <text className="t-name" x="20" y="200">
          Your agent
        </text>
        <text className="t-sub" x="20" y="222">
          Iris, in this lab
        </text>

        <rect
          className="node company"
          x="0"
          y="336"
          width="232"
          height="72"
          rx="6"
        />
        <text className="t-name" x="20" y="368">
          The company
        </text>
        <text className="t-sub" x="20" y="390">
          Juniper Market, in this lab
        </text>

        <text className="t-label" x="34" y="125">
          1 · You ask
        </text>
        <text className="t-label" x="34" y="291">
          signed requests
        </text>
        <text className="t-label" x="158" y="282">
          changes held
        </text>
        <text className="t-label" x="158" y="300">
          for approval
        </text>

        <rect className="tag" x="134" y="104" width="126" height="32" rx="4" />
        <text className="t-tag" x="197" y="125" textAnchor="middle">
          3 · You approve
        </text>
        <rect className="tag" x="240" y="180" width="120" height="48" rx="4" />
        <text className="t-tag" x="300" y="200" textAnchor="middle">
          2 · You sign in
        </text>
        <text className="t-tag" x="300" y="218" textAnchor="middle">
          at the company
        </text>
      </svg>
      <figcaption>
        Who talks to whom. Amber marks the two things only you do.
      </figcaption>
    </figure>
  );
}
