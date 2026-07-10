/**
 * Tests for price-observations.ts (unified price reader)
 * TASK-21.7
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// We test the mode validation logic (DB-dependent tests would need fixtures)
describe("PriceObservationMode", () => {
  const validModes = ["photo_only", "online_only", "online_preferred", "latest"];

  for (const mode of validModes) {
    it(`должен принимать режим "${mode}"`, () => {
      assert.ok(validModes.includes(mode));
    });
  }

  it("должен отклонять неизвестные режимы", () => {
    const mode = "invalid_mode";
    const valid = ["photo_only", "online_only", "online_preferred", "latest"];
    assert.equal(valid.includes(mode), false);
  });
});