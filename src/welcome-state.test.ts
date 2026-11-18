import { expect, test } from "vitest";

import { welcomeSteps } from "./welcome-state";

test("shows only the steps an install needs", () => {
  expect(welcomeSteps({ reload: false })).toEqual(["pin", "done"]);
  expect(welcomeSteps({ reload: true })).toEqual(["pin", "reload", "done"]);
});
