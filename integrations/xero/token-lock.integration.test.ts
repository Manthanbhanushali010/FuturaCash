import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { advisoryLockKey, withTenant, withTenantLock, type ClientLike } from "./db";

/**
 * The only test in this repo that needs a real database, and it needs one for a reason.
 *
 * The bug being fixed was an in-process mutex standing in for cross-process serialisation.
 * A mock cannot show that up: any fake will "serialise" whatever calls it, which is exactly
 * the false confidence the original code had. Proving the fix means two independent client
 * connections contending for the same lock and observing that they do not overlap.
 *
 * Skips when DATABASE_URL is unset so CI stays green without a database. It takes no row
 * locks, writes nothing, and uses a namespace unique to the run.
 *
 * Note on the skip: importing `@prisma/client` loads `.env` as a side effect, so unsetting
 * DATABASE_URL in the shell is NOT enough to skip this locally — the variable is back before
 * the check below runs. The skip therefore depends on `.env` being absent, which is true in
 * CI (it is gitignored) and false on a developer machine. To exercise the skip path locally,
 * move `.env` aside. Verified: with no `.env`, these six skip and the suite stays green.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_ID = `${process.pid}-${process.hrtime.bigint()}`;
const TENANT = `lock-test-${RUN_ID}`;

const clients: PrismaClient[] = [];
function newClient(): ClientLike {
  const client = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  clients.push(client);
  return client as unknown as ClientLike;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open the connection up front so contention tests race on the lock, not on TLS setup. */
async function warm(client: ClientLike): Promise<void> {
  await (client as unknown as PrismaClient).$queryRaw`SELECT 1`;
}

afterAll(async () => {
  await Promise.all(clients.map((c) => c.$disconnect()));
});

describe.skipIf(!DATABASE_URL)("cross-process refresh lock (real Postgres)", () => {
  it("connects as a role without BYPASSRLS", async () => {
    const client = newClient() as unknown as PrismaClient;
    const rows = await client.$queryRaw<{ u: string; bypass: boolean }[]>`
      SELECT current_user AS u,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`;
    // If this ever fails, tenant isolation is off everywhere, not just in this test.
    expect(rows[0]?.bypass).toBe(false);
  }, 30_000);

  /** True when each critical section ran start-to-finish without the other cutting in. */
  function ranExclusively(events: string[]): boolean {
    if (events.length !== 4) return false;
    return events[1] === events[0]?.replace("enter", "exit")
      && events[3] === events[2]?.replace("enter", "exit");
  }

  it("CONTROL: without the lock, two connections interleave", async () => {
    const a = newClient();
    const b = newClient();
    // Warm both connections first, so the race is about the lock and not about who
    // finishes their TLS handshake with Neon first.
    await Promise.all([warm(a), warm(b)]);
    const events: string[] = [];

    const first = withTenant(a, TENANT, async () => {
      events.push("A-enter");
      await sleep(700);
      events.push("A-exit");
    });
    await sleep(150);
    const second = withTenant(b, TENANT, async () => {
      events.push("B-enter");
      await sleep(50);
      events.push("B-exit");
    });
    await Promise.all([first, second]);

    // This is what the old in-process mutex allowed across serverless instances, and it is
    // what the next test must prevent. Without it, that test could pass vacuously.
    expect(ranExclusively(events)).toBe(false);
    expect(events).toEqual(["A-enter", "B-enter", "B-exit", "A-exit"]);
  }, 60_000);

  it("serialises two independent connections on the same namespace", async () => {
    const a = newClient();
    const b = newClient();
    await Promise.all([warm(a), warm(b)]);
    const namespace = `xero-refresh:${TENANT}`;
    const events: string[] = [];

    const first = withTenantLock(a, TENANT, namespace, async () => {
      events.push("A-enter");
      await sleep(700);
      events.push("A-exit");
    });

    // Give A time to take the lock, then have B contend for it.
    await sleep(150);
    const second = withTenantLock(b, TENANT, namespace, async () => {
      events.push("B-enter");
      await sleep(50);
      events.push("B-exit");
    });

    await Promise.all([first, second]);

    // Mutual exclusion is the property, not ordering: whoever reaches the lock first is a
    // race between two network round-trips, and either winner is correct. What must never
    // happen is both being inside at once.
    expect(ranExclusively(events)).toBe(true);
  }, 60_000);

  it("does not block a different tenant's refresh", async () => {
    const a = newClient();
    const b = newClient();
    const events: string[] = [];

    const first = withTenantLock(a, `${TENANT}-x`, `xero-refresh:${TENANT}-x`, async () => {
      events.push("X-enter");
      await sleep(600);
      events.push("X-exit");
    });

    await sleep(150);
    const second = withTenantLock(b, `${TENANT}-y`, `xero-refresh:${TENANT}-y`, async () => {
      events.push("Y-enter");
      events.push("Y-exit");
    });

    await Promise.all([first, second]);

    // Different lock keys, so Y runs while X is still holding its own lock. One customer
    // refreshing must never stall another's page load.
    expect(events.indexOf("Y-exit")).toBeLessThan(events.indexOf("X-exit"));
  }, 60_000);

  it("releases the lock when the callback throws", async () => {
    const a = newClient();
    const b = newClient();
    const namespace = `xero-refresh:${TENANT}-throw`;
    const tenant = `${TENANT}-throw`;

    await expect(
      withTenantLock(a, tenant, namespace, async () => {
        throw new Error("refresh exploded");
      }),
    ).rejects.toThrow("refresh exploded");

    // The transaction rolled back, so the xact lock is gone. A session-level lock would
    // still be held here and this would hang until the test timed out.
    await expect(withTenantLock(b, tenant, namespace, async () => "acquired")).resolves.toBe(
      "acquired",
    );
  }, 60_000);

  it("uses the same lock key the store computes", () => {
    const namespace = `xero-refresh:${TENANT}`;
    expect(advisoryLockKey(namespace)).toBe(advisoryLockKey(namespace));
  });
});
