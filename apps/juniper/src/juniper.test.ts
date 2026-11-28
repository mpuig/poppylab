import { expect, it } from "vitest";
import { visitors } from "./test-visitors.js";

it("requires both poppy:read and poppy:write on proposal routes, while GET works with poppy:read", async () => {
  const { app, visitor } = await visitors();
  try {
    const writeOnly = await visitor("usr_write", undefined, "poppy:write");
    const readOnly = await visitor("usr_read", undefined, "poppy:read");
    const readWrite = await visitor(
      "usr_rw",
      undefined,
      "poppy:read poppy:write",
    );

    const proposals: Array<[string, Record<string, unknown>]> = [
      ["/api/account/checkout", { day: "Saturday" }],
      ["/api/account/basket-change", { product_id: "apples", quantity: 2 }],
      ["/api/account/delivery-change", { day: "Saturday" }],
      [
        "/api/account/delivery-items-change",
        { product_id: "apples", quantity: 2 },
      ],
      [
        "/api/account/profile-proposal",
        {
          version: 1,
          name: "Changed Name",
          email: "changed@example.invalid",
          address: "Changed fictional address",
        },
      ],
      [
        "/api/account/case-proposal",
        {
          topic: "delivery",
          subject: "Question",
          message: "Checking order status",
        },
      ],
      ["/api/account/case-resolution", { case_id: "case_001" }],
    ];

    for (const [url, payload] of proposals) {
      const denied = await writeOnly("POST", url, payload);
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: "insufficient_scope" });
      expect(denied.headers["www-authenticate"]).toBe(
        'DPoP error="insufficient_scope", scope="poppy:read poppy:write"',
      );
      for (const leaked of [
        "approval_required",
        "Elena Maren",
        "elena@example.invalid",
        "Fictional Juniper demo address",
        "Cara cara oranges",
        "delivery_001",
      ])
        expect(denied.body).not.toContain(leaked);
    }

    // GET account routes still work with a read-only grant.
    const profile = await readOnly("GET", "/api/account/profile");
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile.name).toBe("Elena Maren");
    expect((await readOnly("GET", "/api/account/basket")).statusCode).toBe(200);
    expect((await readOnly("GET", "/api/account/orders")).statusCode).toBe(200);
    expect((await readOnly("GET", "/api/account/deliveries")).statusCode).toBe(
      200,
    );

    // A read+write grant proceeds to the approval_required proposal.
    const checkout = await readWrite("POST", "/api/account/checkout", {
      day: "Saturday",
    });
    expect(checkout.statusCode).toBe(403);
    expect(checkout.json().error).toBe("approval_required");
    expect(checkout.json().operation.terms).toMatchObject({
      kind: "checkout",
      delivery_day: "Saturday",
      recipient: "Elena Maren",
    });

    const profileProposal = await readWrite(
      "POST",
      "/api/account/profile-proposal",
      {
        version: 1,
        name: "Changed Name",
        email: "changed@example.invalid",
        address: "Changed fictional address",
      },
    );
    expect(profileProposal.statusCode).toBe(403);
    expect(profileProposal.json().error).toBe("approval_required");
    expect(profileProposal.json().operation.terms).toMatchObject({
      kind: "profile_change",
      before_profile: { name: "Elena Maren" },
    });
  } finally {
    await app.close();
  }
});
