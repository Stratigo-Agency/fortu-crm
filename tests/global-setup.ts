import { resetTestDatabase } from "../scripts/test-db-reset.mjs";

// Once per `npm test`: a fresh fortu_test database with every migration applied.
export default async function setup() {
  await resetTestDatabase({ log: () => {} });
}
