import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAuthUserEmailMap } from "../src/lib/supabase/auth-user-email-map";

function createAdminDouble(pages: Array<Array<{ id: string; email: string | null }>>) {
  const calls: number[] = [];

  const admin = {
    auth: {
      admin: {
        async listUsers(input: { page: number; perPage: number }) {
          calls.push(input.page);
          return {
            data: {
              users: pages[input.page - 1] ?? [],
            },
            error: null,
          };
        },
      },
    },
  } as unknown as SupabaseClient;

  return { admin, calls };
}

test("loadAuthUserEmailMap paginates until requested users are found", async () => {
  const { admin, calls } = createAdminDouble([
    Array.from({ length: 1000 }, (_, index) => ({
      id: `page-1-user-${index}`,
      email: `page-1-user-${index}@example.com`,
    })),
    Array.from({ length: 1000 }, (_, index) => ({
      id: `page-2-user-${index}`,
      email: `page-2-user-${index}@example.com`,
    })),
    [
      {
        id: "target-user",
        email: "Target@Example.com",
      },
    ],
  ]);

  const emailMap = await loadAuthUserEmailMap(admin, ["target-user"], {
    errorCode: "lookup_failed",
    errorMessage: "Unable to load users.",
  });

  assert.equal(emailMap.get("target-user"), "target@example.com");
  assert.deepEqual(calls, [1, 2, 3]);
});

test("loadAuthUserEmailMap stops after the final short page", async () => {
  const { admin, calls } = createAdminDouble([
    [
      {
        id: "other-user",
        email: "other@example.com",
      },
    ],
  ]);

  const emailMap = await loadAuthUserEmailMap(admin, ["missing-user"], {
    errorCode: "lookup_failed",
    errorMessage: "Unable to load users.",
  });

  assert.equal(emailMap.size, 0);
  assert.deepEqual(calls, [1]);
});
