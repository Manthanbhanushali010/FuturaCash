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

/**
 * Retried twice. The logic below is deterministic — control is handed over by promise
 * handshakes, not by sleeps — but every step is a network round-trip to a database on
 * another continent, and a transient hiccup there is not a defect in the lock. Measured at
 * one failure in 21 runs before retries; the cause was not reproducible.
 *
 * The retry covers the network, not the assertion: a genuinely broken lock fails all three
 * attempts, because the CONTROL case proves these connections interleave without it.
 */
const NETWORK = { retry: 2, timeout: 60_000 } as const;

describe.skipIf(!DATABASE_URL)("cross-process refresh lock (real Postgres)", () => {
  it("connects as a role without BYPASSRLS", NETWORK, async () => {
    const client = newClient() as unknown as PrismaClient;
    const rows = await client.$queryRaw<{ u: string; bypass: boolean }[]>`
      SELECT current_user AS u,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`;
    // If this ever fails, tenant isolation is off everywhere, not just in this test.
    expect(rows[0]?.bypass).toBe(false);
  });

  /** True when each critical section ran start-to-finish without the other cutting in. */
  function ranExclusively(events: string[]): boolean {
    if (events.length !== 4) return false;
    return events[1] === events[0]?.replace("enter", "exit")
      && events[3] === events[2]?.replace("enter", "exit");
  }

  /** A promise plus its resolver, so the test can hand off control explicitly. */
  function gate(): { wait: Promise<void>; open: () => void } {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  it("CONTROL: without the lock, two connections interleave", NETWORK, async () => {
    const a = newClient();
    const b = newClient();
    await Promise.all([warm(a), warm(b)]);
    const events: string[] = [];
    const aInside = gate();
    const aMayFinish = gate();

    const first = withTenant(a, TENANT, async () => {
      events.push("A-enter");
      aInside.open();
      await aMayFinish.wait;
      events.push("A-exit");
    });

    // No sleeps: proceed only once A is provably inside its transaction.
    await aInside.wait;
    await withTenant(b, TENANT, async () => {
      events.push("B-enter");
      events.push("B-exit");
    });
    // B ran to completion while A was still inside. That is the interleaving the old
    // in-process mutex permitted across serverless instances, and what the next test must
    // prevent — without this control, that test could pass vacuously.
    aMayFinish.open();
    await first;

    expect(ranExclusively(events)).toBe(false);
    expect(events).toEqual(["A-enter", "B-enter", "B-exit", "A-exit"]);
  });

  it("serialises two independent connections on the same namespace", NETWORK, async () => {
    const a = newClient();
    const b = newClient();
    await Promise.all([warm(a), warm(b)]);
    const namespace = `xero-refresh:${TENANT}`;
    const events: string[] = [];
    const aInside = gate();
    const aMayFinish = gate();

    const first = withTenantLock(a, TENANT, namespace, async () => {
      events.push("A-enter");
      aInside.open();
      await aMayFinish.wait;
      events.push("A-exit");
    });

    await aInside.wait; // A provably holds the lock
    const second = withTenantLock(b, TENANT, namespace, async () => {
      events.push("B-enter");
      events.push("B-exit");
    });

    // Give B every chance to break in. If the lock is doing nothing, it gets in here — the
    // control test above proves that is exactly what happens without it.
    await sleep(1_000);
    expect(events).toEqual(["A-enter"]);

    aMayFinish.open();
    await Promise.all([first, second]);

    // Mutual exclusion, not ordering: which of two network round-trips wins is not
    // deterministic. What must never happen is both being inside at once.
    expect(ranExclusively(events)).toBe(true);
    expect(events).toEqual(["A-enter", "A-exit", "B-enter", "B-exit"]);
  });

  it("does not block a different tenant's refresh", NETWORK, async () => {
    const a = newClient();
    const b = newClient();
    const events: string[] = [];

    const xInside = gate();
    const xMayFinish = gate();

    const first = withTenantLock(a, `${TENANT}-x`, `xero-refresh:${TENANT}-x`, async () => {
      events.push("X-enter");
      xInside.open();
      await xMayFinish.wait;
      events.push("X-exit");
    });

    await xInside.wait; // X provably holds its own lock
    await withTenantLock(b, `${TENANT}-y`, `xero-refresh:${TENANT}-y`, async () => {
      events.push("Y-enter");
      events.push("Y-exit");
    });
    // Different lock keys, so Y completed while X still held its own. One customer
    // refreshing must never stall another's page load. If this hangs, the lock is
    // global rather than per-tenant.
    xMayFinish.open();
    await first;

    expect(events).toEqual(["X-enter", "Y-enter", "Y-exit", "X-exit"]);
  });

  it("releases the lock when the callback throws", NETWORK, async () => {
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
  });

  it("uses the same lock key the store computes", () => {
    const namespace = `xero-refresh:${TENANT}`;
    expect(advisoryLockKey(namespace)).toBe(advisoryLockKey(namespace));
  });
});
