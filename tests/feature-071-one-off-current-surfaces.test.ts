import assert from "node:assert/strict";
import test from "node:test";

import {
  filterCurrentOneOffInviteRows,
  filterCurrentOneOffPeopleOptions,
} from "../src/lib/projects/current-one-off-consent";

test("current one-off invite filtering keeps pending/current rows and hides superseded signed rows", () => {
  const filtered = filterCurrentOneOffInviteRows([
    {
      id: "pending-invite",
      consents: null,
    },
    {
      id: "current-signed-invite",
      consents: [
        {
          id: "current-consent",
          superseded_at: null,
        },
      ],
    },
    {
      id: "superseded-signed-invite",
      consents: [
        {
          id: "superseded-consent",
          superseded_at: "2026-04-22T10:00:00.000Z",
        },
      ],
    },
  ]);

  assert.deepEqual(
    filtered.map((invite) => invite.id),
    ["pending-invite", "current-signed-invite"],
  );
});

test("current one-off people filtering hides superseded consent rows", () => {
  const filtered = filterCurrentOneOffPeopleOptions([
    {
      id: "current-consent",
      superseded_at: null,
      subjects: [
        {
          full_name: "Jordan Miles",
          email: "jordan@example.com",
        },
      ],
    },
    {
      id: "superseded-consent",
      superseded_at: "2026-04-22T10:00:00.000Z",
      subjects: [
        {
          full_name: "Jordan Miles",
          email: "jordan@example.com",
        },
      ],
    },
  ]);

  assert.deepEqual(
    filtered.map((row) => row.id),
    ["current-consent"],
  );
});
