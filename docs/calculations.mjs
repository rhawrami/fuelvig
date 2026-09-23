export const TREATMENT_DATE = "2026-02-28";
export const BASELINE_START_DATE = "2026-01-29";
export const BASELINE_END_DATE = "2026-02-27";

export function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((total, value) => total + value, 0) / usable.length : null;
}

export function extractSeries(prices, jurisdiction, grade) {
  const isNational = jurisdiction === "US";
  const grades = isNational ? prices.nationalGrades : prices.stateGrades;
  const gradeIndex = grades.indexOf(grade);
  if (gradeIndex === -1) {
    return [];
  }

  const rows = isNational ? prices.national : prices.states[jurisdiction] ?? [];
  return rows
    .map((row) => ({ date: row[0], value: row[gradeIndex + 1] }))
    .filter((point) => Number.isFinite(point.value));
}

export function distributeFills(fillCount) {
  if (!Number.isInteger(fillCount) || fillCount < 1) {
    throw new Error("Fill count must be a positive integer");
  }
  const fills = [0, 0, 0, 0];
  for (let index = 0; index < fillCount; index += 1) {
    fills[index % fills.length] += 1;
  }
  return fills;
}

function weekOfMonth(date) {
  const day = Number(date.slice(8, 10));
  return Math.min(3, Math.floor((day - 1) / 7));
}

function groupByMonth(points) {
  return points.reduce((months, point) => {
    const month = point.date.slice(0, 7);
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month).push(point);
    return months;
  }, new Map());
}

function elapsedMonths(firstMonth, currentMonth) {
  const [firstYear, firstMonthNumber] = firstMonth.split("-").map(Number);
  const [currentYear, currentMonthNumber] = currentMonth.split("-").map(Number);
  return (currentYear - firstYear) * 12 + currentMonthNumber - firstMonthNumber;
}

export function calculateEstimate({
  series,
  tankGallons,
  fillsPerMonth,
  monthlyTrendPercent = 0,
}) {
  if (!Number.isFinite(tankGallons) || tankGallons <= 0) {
    throw new Error("Tank capacity must be positive");
  }
  if (!Number.isInteger(fillsPerMonth) || fillsPerMonth < 1) {
    throw new Error("Fills per month must be a positive integer");
  }
  if (!Number.isFinite(monthlyTrendPercent) || monthlyTrendPercent <= -100) {
    throw new Error("Monthly trend must be greater than -100 percent");
  }

  const baselinePoints = series.filter(
    (point) => point.date >= BASELINE_START_DATE && point.date <= BASELINE_END_DATE,
  );
  const baselinePrice = mean(baselinePoints.map((point) => point.value));
  if (!Number.isFinite(baselinePrice)) {
    throw new Error("No observations are available in the baseline window");
  }

  const postTreatment = series.filter((point) => point.date >= TREATMENT_DATE);
  const months = [...groupByMonth(postTreatment).entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (!months.length) {
    throw new Error("No post-treatment observations are available");
  }

  const gallonsPerFill = tankGallons * 0.75;
  const fillDistribution = distributeFills(fillsPerMonth);
  const trendRate = monthlyTrendPercent / 100;
  const firstMonth = months[0][0];
  const lastMonth = months.at(-1)[0];
  const lastObservationDate = months.at(-1)[1].at(-1).date;
  const monthly = months.map(([month, points]) => {
    const monthIndex = elapsedMonths(firstMonth, month);
    const monthlyAverage = mean(points.map((point) => point.value));
    let fillPrices;

    if (fillsPerMonth === 1) {
      fillPrices = [monthlyAverage];
    } else {
      const weekAverages = [0, 1, 2, 3].map((week) => {
        const weekValues = points
          .filter((point) => weekOfMonth(point.date) === week)
          .map((point) => point.value);
        return mean(weekValues) ?? monthlyAverage;
      });
      const completedPeriods = month === lastMonth ? weekOfMonth(lastObservationDate) + 1 : 4;
      fillPrices = weekAverages
        .slice(0, completedPeriods)
        .flatMap((price, week) => Array.from({ length: fillDistribution[week] }, () => price));
    }

    const actualPrice = mean(fillPrices);
    const counterfactualPrice = baselinePrice * (1 + trendRate) ** monthIndex;
    const actualCost = fillPrices.reduce(
      (total, price) => total + price * gallonsPerFill,
      0,
    );
    const counterfactualCost = counterfactualPrice * gallonsPerFill * fillPrices.length;

    return {
      month,
      fillCount: fillPrices.length,
      observationCount: points.length,
      actualPrice,
      counterfactualPrice,
      actualCost,
      counterfactualCost,
      excessCost: actualCost - counterfactualCost,
    };
  });

  return {
    baselinePrice,
    baselineObservationCount: baselinePoints.length,
    gallonsPerFill,
    monthly,
    actualCost: monthly.reduce((total, entry) => total + entry.actualCost, 0),
    counterfactualCost: monthly.reduce(
      (total, entry) => total + entry.counterfactualCost,
      0,
    ),
    excessCost: monthly.reduce((total, entry) => total + entry.excessCost, 0),
  };
}
