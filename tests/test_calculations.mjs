import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEstimate,
  distributeFills,
  extractSeries,
} from "../docs/calculations.mjs";

test("extracts compact national and state price series by declared grade order", () => {
  const prices = {
    nationalGrades: ["regular", "diesel"],
    stateGrades: ["regular", "diesel"],
    national: [["2026-01-01", 2.5, 3.5]],
    states: { CA: [["2026-01-01", 3.5, null]] },
  };

  assert.deepEqual(extractSeries(prices, "US", "diesel"), [
    { date: "2026-01-01", value: 3.5 },
  ]);
  assert.deepEqual(extractSeries(prices, "CA", "regular"), [
    { date: "2026-01-01", value: 3.5 },
  ]);
  assert.deepEqual(extractSeries(prices, "CA", "diesel"), []);
});

test("distributes repeated fills evenly and deterministically", () => {
  assert.deepEqual(distributeFills(1), [1, 0, 0, 0]);
  assert.deepEqual(distributeFills(4), [1, 1, 1, 1]);
  assert.deepEqual(distributeFills(6), [2, 2, 1, 1]);
  assert.deepEqual(distributeFills(10), [3, 3, 2, 2]);
});

test("uses the 30-day baseline, weekly fills, and compounded monthly trend", () => {
  const series = [
    { date: "2026-01-29", value: 1 },
    { date: "2026-02-27", value: 3 },
    { date: "2026-03-01", value: 4 },
    { date: "2026-03-08", value: 6 },
    { date: "2026-03-15", value: 8 },
    { date: "2026-03-22", value: 10 },
    { date: "2026-04-01", value: 4 },
    { date: "2026-04-08", value: 4 },
    { date: "2026-04-15", value: 4 },
    { date: "2026-04-22", value: 4 },
  ];

  const estimate = calculateEstimate({
    series,
    tankGallons: 20,
    fillsPerMonth: 6,
    monthlyTrendPercent: 5,
  });

  assert.equal(estimate.baselinePrice, 2);
  assert.equal(estimate.baselineObservationCount, 2);
  assert.equal(estimate.gallonsPerFill, 15);
  assert.equal(estimate.monthly[0].actualPrice, 38 / 6);
  assert.equal(estimate.monthly[0].counterfactualPrice, 2);
  assert.equal(estimate.monthly[1].counterfactualPrice, 2.1);
  assert.equal(estimate.actualCost, 930);
  assert.equal(estimate.counterfactualCost, 369);
  assert.equal(estimate.excessCost, 561);
});

test("uses one monthly average for one fill", () => {
  const estimate = calculateEstimate({
    series: [
      { date: "2026-02-13", value: 2 },
      { date: "2026-03-01", value: 3 },
      { date: "2026-03-31", value: 5 },
    ],
    tankGallons: 10,
    fillsPerMonth: 1,
  });

  assert.equal(estimate.monthly[0].actualPrice, 4);
  assert.equal(estimate.monthly[0].actualCost, 30);
  assert.equal(estimate.monthly[0].counterfactualCost, 15);
});

test("continues compounding across a month with no observations", () => {
  const estimate = calculateEstimate({
    series: [
      { date: "2026-02-13", value: 1 },
      { date: "2026-03-10", value: 2 },
      { date: "2026-05-10", value: 2 },
    ],
    tankGallons: 10,
    fillsPerMonth: 1,
    monthlyTrendPercent: 10,
  });

  assert.equal(estimate.monthly[0].counterfactualPrice, 1);
  assert.ok(Math.abs(estimate.monthly[1].counterfactualPrice - 1.21) < 1e-12);
});

test("does not charge future weekly fills in an incomplete current month", () => {
  const estimate = calculateEstimate({
    series: [
      { date: "2026-02-13", value: 1 },
      { date: "2026-03-01", value: 2 },
      { date: "2026-03-08", value: 2 },
      { date: "2026-03-15", value: 2 },
      { date: "2026-03-21", value: 2 },
    ],
    tankGallons: 10,
    fillsPerMonth: 4,
  });

  assert.equal(estimate.monthly[0].fillCount, 3);
  assert.equal(estimate.monthly[0].actualCost, 45);
  assert.equal(estimate.monthly[0].counterfactualCost, 22.5);
});
