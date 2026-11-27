import Stripe from "stripe";
import express from "express";
import type { Express } from "express";
import type { DB } from "./db.ts";
import { assert, type User } from "./domain.ts";
import { event } from "./store.ts";
const hosted = () => process.env.BILLING_MODE === "stripe";
const priceIds = () =>
  [
    process.env.STRIPE_PRICE_ID,
    ...(process.env.STRIPE_ADDITIONAL_PRICE_IDS || "").split(","),
  ].filter(Boolean) as string[];
export function stripeClient(injected?: Stripe) {
  if (injected) return injected;
  assert(process.env.STRIPE_SECRET_KEY, 503, "Stripe is not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20000,
  });
}
export async function entitlement(db: DB, orgId: string) {
  if (!hosted())
    return {
      mode: "open_source",
      allowed: true,
      status: "included",
      modules: ["dashboard"],
      validUntil: null,
    };
  const sub = (
    await db.query("SELECT * FROM subscriptions WHERE org_id=$1", [orgId])
  ).rows[0];
  const allowed =
    !!sub &&
    ["active", "trialing"].includes(sub.status) &&
    +new Date(sub.valid_until) > Date.now() &&
    priceIds().includes(sub.price_id);
  return {
    mode: "stripe",
    allowed,
    status: sub?.status || "not_subscribed",
    modules: allowed ? ["dashboard"] : [],
    validUntil: sub?.valid_until || null,
  };
}
export function installBillingWebhook(app: Express, db: DB, injected?: Stripe) {
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      assert(
        hosted() && process.env.STRIPE_WEBHOOK_SECRET,
        503,
        "Hosted billing is not configured",
      );
      const stripe = stripeClient(injected);
      let message: Stripe.Event;
      try {
        message = stripe.webhooks.constructEvent(
          req.body,
          req.get("stripe-signature") || "",
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch {
        res.status(400).json({ error: "Invalid webhook signature" });
        return;
      }
      const object = message.data.object as any;
      let subId = "";
      let orgId = "";
      if (message.type === "checkout.session.completed") {
        subId =
          typeof object.subscription === "string"
            ? object.subscription
            : object.subscription?.id;
        orgId = object.client_reference_id;
      } else if (message.type.startsWith("customer.subscription.")) {
        subId = object.id;
        orgId = object.metadata?.organizationId;
      } else {
        res.json({ received: true });
        return;
      }
      if (!orgId && subId)
        orgId = (
          await db.query(
            "SELECT org_id FROM subscriptions WHERE subscription_id=$1",
            [subId],
          )
        ).rows[0]?.org_id;
      if (!subId || !orgId) {
        res.json({ received: true, ignored: true });
        return;
      }
      await db.transaction(async (tx) => {
        const org = (
          await tx.query(
            "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
            [orgId],
          )
        ).rows[0];
        assert(org, 400, "Unknown subscription organization");
        if (
          (
            await tx.query("SELECT id FROM billing_events WHERE id=$1", [
              message.id,
            ])
          ).rows.length
        )
          return;
        const current = await stripe.subscriptions.retrieve(subId);
        const previous = (
          await tx.query(
            "SELECT subscription_id,status FROM subscriptions WHERE org_id=$1",
            [orgId],
          )
        ).rows[0];
        if (
          previous &&
          previous.subscription_id !== subId &&
          ["active", "trialing"].includes(previous.status) &&
          !["active", "trialing"].includes(current.status)
        ) {
          await tx.query("INSERT INTO billing_events(id) VALUES($1)", [
            message.id,
          ]);
          return;
        }
        assert(
          current.metadata.organizationId === orgId,
          400,
          "Subscription organization mismatch",
        );
        const item = current.items.data.find((i) =>
          priceIds().includes(i.price.id),
        );
        const until = Math.max(
          ...current.items.data.map((i: any) => i.current_period_end || 0),
          Number((current as any).current_period_end || 0),
        );
        assert(until > 0, 400, "Subscription period is missing");
        await tx.query(
          "INSERT INTO subscriptions(org_id,customer_id,subscription_id,status,valid_until,price_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,status=excluded.status,valid_until=excluded.valid_until,price_id=excluded.price_id,updated_at=now()",
          [
            orgId,
            typeof current.customer === "string"
              ? current.customer
              : current.customer.id,
            current.id,
            current.status,
            new Date(until * 1000).toISOString(),
            item?.price.id || "unrecognized",
          ],
        );
        await tx.query("INSERT INTO billing_events(id) VALUES($1)", [
          message.id,
        ]);
        await event(
          tx,
          {
            id: "stripe",
            org_id: orgId,
            name: "Stripe subscription service",
            email: "",
            role: "admin",
            project_ids: [],
          },
          null,
          "subscription",
          current.id,
          "reconciled",
          1,
          {
            status: current.status,
            validUntil: new Date(until * 1000).toISOString(),
            eventId: message.id,
          },
        );
      });
      res.json({ received: true });
    },
  );
}
export function installBilling(app: Express, db: DB, injected?: Stripe) {
  app.get("/api/billing", async (req, res) => {
    const u = res.locals.user as User;
    res.json({
      ...(await entitlement(db, u.org_id)),
      canManage: u.role === "admin",
      checkoutConfigured:
        hosted() &&
        !!process.env.STRIPE_PRICE_ID &&
        !!process.env.STRIPE_SECRET_KEY,
    });
  });
  app.post("/api/billing/checkout", async (req, res) => {
    const u = res.locals.user as User;
    assert(u.role === "admin", 403, "Organization administrator required");
    assert(
      hosted() && process.env.APP_ORIGIN && process.env.STRIPE_PRICE_ID,
      503,
      "Hosted checkout is not configured",
    );
    const current = await entitlement(db, u.org_id);
    assert(
      !current.allowed,
      409,
      "Use the billing portal to manage your active subscription",
    );
    const key = req.get("Idempotency-Key");
    assert(key && key.length <= 150, 400, "Idempotency-Key required");
    const stripe = stripeClient(injected);
    const existing = (
      await db.query("SELECT customer_id FROM subscriptions WHERE org_id=$1", [
        u.org_id,
      ])
    ).rows[0];
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: u.org_id,
        ...(existing
          ? { customer: existing.customer_id }
          : { customer_email: u.email }),
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        subscription_data: { metadata: { organizationId: u.org_id } },
        success_url:
          process.env.APP_ORIGIN + "/?page=Settings&checkout=success",
        cancel_url:
          process.env.APP_ORIGIN + "/?page=Settings&checkout=cancelled",
      },
      { idempotencyKey: `${u.org_id}:${key}` },
    );
    assert(session.url, 502, "Checkout URL unavailable");
    res.json({ url: session.url });
  });
  app.post("/api/billing/portal", async (req, res) => {
    const u = res.locals.user as User;
    assert(u.role === "admin", 403, "Organization administrator required");
    assert(
      hosted() && process.env.APP_ORIGIN,
      503,
      "Hosted billing is not configured",
    );
    const sub = (
      await db.query("SELECT customer_id FROM subscriptions WHERE org_id=$1", [
        u.org_id,
      ])
    ).rows[0];
    assert(sub, 404, "Subscription not found");
    const session = await stripeClient(injected).billingPortal.sessions.create({
      customer: sub.customer_id,
      return_url: process.env.APP_ORIGIN + "/?page=Settings",
    });
    res.json({ url: session.url });
  });
}
export function installEntitlementGate(app: Express, db: DB) {
  app.use("/api", async (req, res, next) => {
    if (
      !hosted() ||
      ["/me", "/organizations", "/password", "/users"].includes(req.path) ||
      req.path.startsWith("/organizations/") ||
      req.path.startsWith("/billing") ||
      req.path.startsWith("/users/") ||
      (req.method === "DELETE" &&
        /^\/projects\/[^/]+\/publications\//.test(req.path))
    ) {
      next();
      return;
    }
    const e = await entitlement(db, res.locals.user.org_id);
    if (!e.allowed) {
      res
        .status(402)
        .json({
          error: "This organization needs an active dashboard subscription",
          entitlement: e,
        });
      return;
    }
    next();
  });
}
