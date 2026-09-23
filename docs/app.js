import {
  BASELINE_END_DATE,
  BASELINE_START_DATE,
  TREATMENT_DATE,
  calculateEstimate,
  extractSeries,
  mean,
} from "./calculations.mjs";

const DATA_ROOT = "data";
const STATE_NAMES = {
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};
const GRADE_LABELS = {
  regular: "Regular",
  midGrade: "Mid-grade",
  premium: "Premium",
  diesel: "Diesel",
  e85: "E85",
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const signedCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});
const signedPrice = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  signDisplay: "always",
});
const price = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const elements = {
  historyJurisdiction: document.querySelector("#history-jurisdiction"),
  historyGrade: document.querySelector("#history-grade"),
  historyRanges: document.querySelectorAll("[data-range-months]"),
  priceUpdateDate: document.querySelector("#price-update-date"),
  historyChart: document.querySelector("#history-chart"),
  latestPrice: document.querySelector("#latest-price"),
  treatmentChange: document.querySelector("#treatment-change"),
  seriesLabel: document.querySelector("#series-label"),
  make: document.querySelector("#vehicle-make"),
  model: document.querySelector("#vehicle-model"),
  year: document.querySelector("#vehicle-year"),
  variant: document.querySelector("#vehicle-variant"),
  vehicleNote: document.querySelector("#vehicle-note"),
  calculatorState: document.querySelector("#calculator-state"),
  calculatorGrade: document.querySelector("#calculator-grade"),
  fills: document.querySelector("#fills-per-month"),
  fillsOutput: document.querySelector("#fills-output"),
  trend: document.querySelector("#counterfactual-trend"),
  trendOutput: document.querySelector("#trend-output"),
  estimateTotal: document.querySelector("#estimate-total"),
  estimateInterpretation: document.querySelector("#estimate-interpretation"),
  gallonsPerFill: document.querySelector("#gallons-per-fill"),
  actualSpend: document.querySelector("#actual-spend"),
  counterfactualSpend: document.querySelector("#counterfactual-spend"),
  baselinePrice: document.querySelector("#baseline-price"),
  estimateCaveat: document.querySelector("#estimate-caveat"),
  estimateChart: document.querySelector("#estimate-chart"),
  estimateChartTitle: document.querySelector("#estimate-chart-title"),
  estimateCaption: document.querySelector("#estimate-caption"),
  estimateTableBody: document.querySelector("#estimate-table-body"),
  tooltip: document.querySelector("#chart-tooltip"),
};

const state = {
  prices: null,
  vehicleIndex: null,
  currentMake: null,
  currentModel: null,
  makeRequestId: 0,
  variants: new Map(),
  selectedVehicle: null,
  estimate: null,
  historyRangeMonths: "12",
};

function parseDate(value) {
  return d3.utcParse("%Y-%m-%d")(value);
}

function setOptions(select, options, placeholder) {
  select.replaceChildren();
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.append(option);
  }
  for (const { value, label } of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function jurisdictionName(code) {
  return code === "US" ? "National" : STATE_NAMES[code] ?? code;
}

function showEmptyChart(container, message) {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-chart";
  empty.textContent = message;
  container.append(empty);
}

function updateHistoryGradeAvailability() {
  const isNational = elements.historyJurisdiction.value === "US";
  const e85 = elements.historyGrade.querySelector('option[value="e85"]');
  e85.disabled = !isNational;
  if (!isNational && elements.historyGrade.value === "e85") {
    elements.historyGrade.value = "regular";
  }
}

function renderHistoryChart() {
  const jurisdiction = elements.historyJurisdiction.value;
  const grade = elements.historyGrade.value;
  const rawSeries = extractSeries(state.prices, jurisdiction, grade);
  const allSeries = rawSeries.map((point) => ({ ...point, parsedDate: parseDate(point.date) }));
  if (!allSeries.length) {
    showEmptyChart(elements.historyChart, "No observations are available for this selection.");
    return;
  }

  const latest = allSeries.at(-1);
  const series =
    state.historyRangeMonths === "all"
      ? allSeries
      : allSeries.filter(
          (point) =>
            point.parsedDate >=
            d3.utcMonth.offset(latest.parsedDate, -Number(state.historyRangeMonths)),
        );

  const baselinePrice = mean(
    rawSeries
      .filter((point) => point.date >= BASELINE_START_DATE && point.date <= BASELINE_END_DATE)
      .map((point) => point.value),
  );
  const change = Number.isFinite(baselinePrice) ? latest.value - baselinePrice : null;
  const changePercent = Number.isFinite(baselinePrice) ? (change / baselinePrice) * 100 : null;
  const label = `${jurisdictionName(jurisdiction)} (${GRADE_LABELS[grade]})`;

  elements.latestPrice.textContent = `${price.format(latest.value)}/gal`;
  elements.treatmentChange.textContent = Number.isFinite(change)
    ? `${change >= 0 ? "+" : ""}${currency.format(change)} (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%)`
    : "Not available";
  elements.treatmentChange.style.color = Number.isFinite(change)
    ? change >= 0
      ? "var(--rose)"
      : "var(--mint)"
    : "var(--paper)";
  elements.seriesLabel.textContent = label;
  elements.historyChart.setAttribute(
    "aria-label",
    `${label} gas prices from ${series[0].date} through ${latest.date}; latest ${price.format(latest.value)} per gallon. Use left and right arrow keys to inspect observations.`,
  );
  elements.historyChart.tabIndex = 0;

  const width = Math.max(320, elements.historyChart.clientWidth);
  const height = width < 620 ? 370 : 480;
  const margin = { top: 28, right: 24, bottom: 42, left: width < 620 ? 52 : 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = d3
    .scaleUtc()
    .domain(d3.extent(series, (point) => point.parsedDate))
    .range([0, innerWidth]);
  const extent = d3.extent(series, (point) => point.value);
  const padding = Math.max(0.15, (extent[1] - extent[0]) * 0.12);
  const y = d3
    .scaleLinear()
    .domain([Math.max(0, extent[0] - padding), extent[1] + padding])
    .nice()
    .range([innerHeight, 0]);

  elements.historyChart.replaceChildren();
  const svg = d3
    .select(elements.historyChart)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("aria-hidden", "true");
  const definitions = svg.append("defs");
  const gradient = definitions
    .append("linearGradient")
    .attr("id", "history-gradient")
    .attr("x1", "0")
    .attr("x2", "0")
    .attr("y1", "0")
    .attr("y2", "1");
  gradient.append("stop").attr("offset", "0%").attr("stop-color", "#a8e6cf").attr("stop-opacity", 0.2);
  gradient.append("stop").attr("offset", "100%").attr("stop-color", "#a8e6cf").attr("stop-opacity", 0);

  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  plot
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""));
  plot
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(width < 620 ? 4 : 7).tickSizeOuter(0));
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((value) => `$${value.toFixed(2)}`));

  const line = d3
    .line()
    .x((point) => x(point.parsedDate))
    .y((point) => y(point.value));
  const area = d3
    .area()
    .x((point) => x(point.parsedDate))
    .y0(innerHeight)
    .y1((point) => y(point.value));
  const segments = series.reduce((groups, point, index) => {
    const previous = series[index - 1];
    const startsNewSegment =
      !previous || point.parsedDate.getTime() - previous.parsedDate.getTime() > 10 * 86400000;
    if (startsNewSegment) {
      groups.push([]);
    }
    groups.at(-1).push(point);
    return groups;
  }, []);
  plot
    .selectAll(".history-area")
    .data(segments)
    .join("path")
    .attr("class", "history-area")
    .attr("d", area);
  plot
    .selectAll(".history-line")
    .data(segments)
    .join("path")
    .attr("class", "history-line")
    .attr("d", line);
  plot
    .selectAll(".history-observation")
    .data(series)
    .join("circle")
    .attr("class", "history-observation")
    .attr("r", series.length > 300 ? 1.2 : 2)
    .attr("cx", (point) => x(point.parsedDate))
    .attr("cy", (point) => y(point.value));

  const treatmentX = x(parseDate(TREATMENT_DATE));
  if (treatmentX >= 0 && treatmentX <= innerWidth) {
    plot
      .append("line")
      .attr("class", "treatment-line")
      .attr("x1", treatmentX)
      .attr("x2", treatmentX)
      .attr("y1", 0)
      .attr("y2", innerHeight);
    plot
      .append("text")
      .attr("class", "treatment-label")
      .attr("x", treatmentX + 8)
      .attr("y", 11)
      .text("Iran War");
  }

  const focusLine = plot.append("line").attr("class", "focus-line").attr("y1", 0).attr("y2", innerHeight).style("opacity", 0);
  const focusDot = plot.append("circle").attr("class", "focus-dot").attr("r", 5).style("opacity", 0);
  const bisect = d3.bisector((point) => point.parsedDate).center;
  let focusIndex = series.length - 1;

  function showPoint(point, clientX, clientY) {
    focusLine.attr("x1", x(point.parsedDate)).attr("x2", x(point.parsedDate)).style("opacity", 1);
    focusDot.attr("cx", x(point.parsedDate)).attr("cy", y(point.value)).style("opacity", 1);
    elements.tooltip.innerHTML = `<strong>${price.format(point.value)} / gal</strong><span>${shortDate.format(point.parsedDate)}</span>`;
    elements.tooltip.style.left = `${clientX}px`;
    elements.tooltip.style.top = `${clientY}px`;
    elements.tooltip.classList.add("visible");
  }

  function hidePoint() {
    focusLine.style("opacity", 0);
    focusDot.style("opacity", 0);
    elements.tooltip.classList.remove("visible");
  }

  plot
    .append("rect")
    .attr("class", "chart-overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .on("mousemove", (event) => {
      const [pointerX] = d3.pointer(event);
      focusIndex = bisect(series, x.invert(pointerX));
      showPoint(series[focusIndex], event.clientX, event.clientY);
    })
    .on("mouseleave", hidePoint);

  d3.select(elements.historyChart)
    .on("focus", () => {
      const bounds = elements.historyChart.getBoundingClientRect();
      const point = series[focusIndex];
      showPoint(
        point,
        bounds.left + margin.left + x(point.parsedDate),
        bounds.top + margin.top + y(point.value),
      );
    })
    .on("blur", hidePoint)
    .on("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      focusIndex = Math.max(
        0,
        Math.min(series.length - 1, focusIndex + (event.key === "ArrowRight" ? 1 : -1)),
      );
      const bounds = elements.historyChart.getBoundingClientRect();
      const point = series[focusIndex];
      showPoint(
        point,
        bounds.left + margin.left + x(point.parsedDate),
        bounds.top + margin.top + y(point.value),
      );
    });
}

function fuelCategory(fuelType) {
  const normalized = (fuelType ?? "").toLowerCase();
  if (normalized.includes("diesel")) {
    return "diesel";
  }
  if (
    normalized.includes("electric") ||
    normalized.includes("hydrogen") ||
    normalized.includes("lpg") ||
    normalized.includes("natural gas")
  ) {
    return "unsupported";
  }
  return "gasoline";
}

function usableCapacity(capacity) {
  return (
    Number.isFinite(capacity?.gallons) &&
    capacity.gallons > 0 &&
    capacity.status !== "invalid"
  );
}

function usableVariant(variant) {
  return (
    fuelCategory(variant.fuelType) !== "unsupported" &&
    (usableCapacity(variant.tankCapacity) || usableCapacity(variant.optionalTankCapacity))
  );
}

function resetSelect(select, message) {
  setOptions(select, [], message);
  select.disabled = true;
}

async function handleMakeChange() {
  const requestId = ++state.makeRequestId;
  resetSelect(elements.model, "Loading models...");
  resetSelect(elements.year, "Select a model first");
  resetSelect(elements.variant, "Select a year first");
  state.currentMake = null;
  state.currentModel = null;
  state.selectedVehicle = null;
  updateEstimate();

  const slug = elements.make.value;
  if (!slug) {
    resetSelect(elements.model, "Select a make first");
    return;
  }

  try {
    const response = await fetch(`${DATA_ROOT}/vehicles/processed/by-make/${slug}.json`);
    if (!response.ok) {
      throw new Error(`Vehicle request failed with ${response.status}`);
    }
    const make = await response.json();
    if (requestId !== state.makeRequestId || elements.make.value !== slug) {
      return;
    }
    state.currentMake = make;
    const models = state.currentMake.models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) =>
        model.generations.some((generation) => generation.variants.some(usableVariant)),
      )
      .map(({ model, index }) => ({ value: String(index), label: model.name }));
    setOptions(elements.model, models, "Select a model");
    elements.model.disabled = false;
    setVehicleNote("Select a model and year to find a tank capacity.");
  } catch (error) {
    if (requestId !== state.makeRequestId) {
      return;
    }
    resetSelect(elements.model, "Models unavailable");
    setVehicleNote(error.message, "error");
  }
}

function handleModelChange() {
  resetSelect(elements.year, "Select a model first");
  resetSelect(elements.variant, "Select a year first");
  state.currentModel = null;
  state.selectedVehicle = null;
  updateEstimate();
  if (elements.model.value === "") {
    return;
  }

  state.currentModel = state.currentMake.models[Number(elements.model.value)];
  const latestYear = Number(state.prices.lastDate.slice(0, 4));
  const years = new Set();
  for (const generation of state.currentModel.generations) {
    if (!generation.variants.some(usableVariant) || !Number.isInteger(generation.yearStart)) {
      continue;
    }
    const end = Math.min(generation.yearEnd ?? latestYear, latestYear);
    for (let year = generation.yearStart; year <= end; year += 1) {
      years.add(year);
    }
  }
  const options = [...years]
    .sort((left, right) => right - left)
    .map((year) => ({ value: String(year), label: String(year) }));
  setOptions(elements.year, options, "Select a year");
  elements.year.disabled = false;
}

function variantLabel(generation, variant, capacity, capacityLabel) {
  const details = [generation.name, variant.engine, variant.fuelType, variant.transmission]
    .filter(Boolean)
    .join(" | ");
  return `${details} | ${capacity.gallons.toFixed(1)} gal${capacityLabel}`;
}

function combinedStatus(candidates) {
  if (candidates.some((candidate) => candidate.capacity.status === "suspect")) {
    return "suspect";
  }
  if (candidates.every((candidate) => candidate.capacity.status === "verified")) {
    return "verified";
  }
  return "unverified";
}

function handleYearChange() {
  resetSelect(elements.variant, "Select a year first");
  state.variants.clear();
  state.selectedVehicle = null;
  updateEstimate();
  if (!elements.year.value) {
    return;
  }

  const year = Number(elements.year.value);
  const candidates = [];
  state.currentModel.generations.forEach((generation, generationIndex) => {
    const matchesYear =
      generation.yearStart <= year && (generation.yearEnd == null || year <= generation.yearEnd);
    if (!matchesYear) {
      return;
    }
    generation.variants.forEach((variant, variantIndex) => {
      if (!usableVariant(variant)) {
        return;
      }
      for (const [capacityKey, capacity, capacityLabel] of [
        ["standard", variant.tankCapacity, ""],
        ["optional", variant.optionalTankCapacity, " (optional tank)"],
      ]) {
        if (!usableCapacity(capacity)) {
          continue;
        }
        candidates.push({
          id: `${generationIndex}:${variantIndex}:${capacityKey}`,
          label: variantLabel(generation, variant, capacity, capacityLabel),
          generation: generation.name,
          engine: variant.engine,
          fuelType: variant.fuelType,
          category: fuelCategory(variant.fuelType),
          capacity,
        });
      }
    });
  });

  if (!candidates.length) {
    resetSelect(elements.variant, "No usable tank capacity for this year");
    setVehicleNote("No compatible tank capacity is available for this model year.", "error");
    return;
  }

  const capacities = new Set(candidates.map((candidate) => candidate.capacity.gallons.toFixed(2)));
  const categories = new Set(candidates.map((candidate) => candidate.category));
  if (capacities.size === 1 && categories.size === 1) {
    const representative = candidates[0];
    const automatic = {
      ...representative,
      id: "automatic",
      label: `Matching variants share ${representative.capacity.gallons.toFixed(1)} gal`,
      capacity: {
        ...representative.capacity,
        status: combinedStatus(candidates),
      },
    };
    state.variants.set(automatic.id, automatic);
    setOptions(elements.variant, [{ value: automatic.id, label: automatic.label }]);
    elements.variant.disabled = true;
    elements.variant.value = automatic.id;
    selectVehicle(automatic);
    return;
  }

  candidates.forEach((candidate) => state.variants.set(candidate.id, candidate));
  setOptions(
    elements.variant,
    candidates.map((candidate) => ({ value: candidate.id, label: candidate.label })),
    "Select an engine or variant",
  );
  elements.variant.disabled = false;
  setVehicleNote("Tank capacity varies across matching engines. Select the closest variant.", "warning");
}

function setVehicleNote(message, type = "") {
  elements.vehicleNote.textContent = message;
  elements.vehicleNote.className = `field-note${type ? ` ${type}` : ""}`;
}

function selectVehicle(vehicle) {
  state.selectedVehicle = vehicle;
  if (vehicle.category === "diesel") {
    elements.calculatorGrade.value = "diesel";
    [...elements.calculatorGrade.options].forEach((option) => {
      option.disabled = option.value !== "diesel";
    });
  } else {
    [...elements.calculatorGrade.options].forEach((option) => {
      option.disabled = option.value === "diesel";
    });
    if (elements.calculatorGrade.value === "diesel") {
      elements.calculatorGrade.value = "regular";
    }
  }

  const capacity = vehicle.capacity;
  const note = `${capacity.gallons.toFixed(1)} gallon reported tank capacity; status: ${capacity.status}.`;
  setVehicleNote(note, capacity.status === "verified" ? "" : "warning");
  updateEstimate();
}

function handleVariantChange() {
  const vehicle = state.variants.get(elements.variant.value);
  if (vehicle) {
    selectVehicle(vehicle);
  } else {
    state.selectedVehicle = null;
    updateEstimate();
  }
}

function resetEstimate(message = "Select your vehicle and state") {
  state.estimate = null;
  elements.estimateTotal.classList.remove("savings");
  elements.estimateTotal.textContent = message;
  elements.estimateInterpretation.textContent =
    "Your estimate will appear here once we have a usable tank capacity.";
  elements.gallonsPerFill.textContent = "--";
  elements.actualSpend.textContent = "--";
  elements.counterfactualSpend.textContent = "--";
  elements.baselinePrice.textContent = "--";
  elements.estimateCaveat.textContent = "";
  elements.estimateTableBody.replaceChildren();
  elements.estimateChartTitle.textContent = "Your price path";
  elements.estimateCaption.textContent =
    "Complete the calculator to compare observed and counterfactual prices.";
  showEmptyChart(elements.estimateChart, "Your comparison will appear here.");
}

function updateEstimate() {
  elements.fillsOutput.textContent = elements.fills.value;
  const trend = Number(elements.trend.value);
  elements.trendOutput.textContent = `${trend > 0 ? "+" : ""}${trend}%`;

  const jurisdiction = elements.calculatorState.value;
  const grade = elements.calculatorGrade.value;
  if (!state.prices || !state.selectedVehicle || !jurisdiction || !grade) {
    resetEstimate();
    return;
  }

  try {
    const series = extractSeries(state.prices, jurisdiction, grade);
    const estimate = calculateEstimate({
      series,
      tankGallons: state.selectedVehicle.capacity.gallons,
      fillsPerMonth: Number(elements.fills.value),
      monthlyTrendPercent: trend,
    });
    state.estimate = estimate;
    const isSavings = estimate.excessCost < 0;
    elements.estimateTotal.textContent = signedCurrency.format(estimate.excessCost);
    elements.estimateTotal.classList.toggle("savings", isSavings);
    elements.estimateInterpretation.textContent = isSavings
      ? "Estimated savings relative to your alternative price path."
      : "Estimated additional spending relative to your alternative price path.";
    elements.gallonsPerFill.textContent = `${estimate.gallonsPerFill.toFixed(1)} gal`;
    elements.actualSpend.textContent = currency.format(estimate.actualCost);
    elements.counterfactualSpend.textContent = currency.format(estimate.counterfactualCost);
    elements.baselinePrice.textContent = `${price.format(estimate.baselinePrice)}/gal`;
    elements.estimateCaveat.textContent = `${estimate.baselineObservationCount} available observation${estimate.baselineObservationCount === 1 ? "" : "s"} in the ${BASELINE_START_DATE} to ${BASELINE_END_DATE} baseline window. Tank status: ${state.selectedVehicle.capacity.status}.`;
    elements.estimateChartTitle.textContent = `${jurisdictionName(jurisdiction)} (${GRADE_LABELS[grade]})`;
    elements.estimateCaption.textContent = `${elements.fills.value} scheduled fill-up${elements.fills.value === "1" ? "" : "s"} per month, ${estimate.gallonsPerFill.toFixed(1)} gallons per fill, with a ${trend > 0 ? "+" : ""}${trend}% compounded monthly alternative trend. The current month excludes future fill periods.`;
    renderEstimateChart(estimate);
  } catch (error) {
    resetEstimate("Estimate unavailable");
    elements.estimateInterpretation.textContent = error.message;
  }
}

function renderEstimateChart(estimate) {
  let cumulativeDifference = 0;
  const series = estimate.monthly.map((entry) => {
    cumulativeDifference += entry.excessCost;
    return {
      ...entry,
      cumulativeDifference,
      parsedDate: parseDate(`${entry.month}-01`),
    };
  });
  if (!series.length) {
    showEmptyChart(elements.estimateChart, "No post-war observations are available.");
    return;
  }

  elements.estimateChart.setAttribute(
    "aria-label",
    `Monthly actual and expected gas-price paths from ${series[0].month} through ${series.at(-1).month}. A text table follows the chart.`,
  );
  elements.estimateTableBody.replaceChildren(
    ...series.map((entry) => {
      const row = document.createElement("tr");
      for (const value of [
        monthDate.format(entry.parsedDate),
        price.format(entry.actualPrice),
        price.format(entry.counterfactualPrice),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );

  const width = Math.max(320, elements.estimateChart.clientWidth);
  const height = width < 620 ? 370 : 460;
  const margin = { top: 24, right: 24, bottom: 42, left: width < 620 ? 52 : 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = d3
    .scaleUtc()
    .domain(d3.extent(series, (entry) => entry.parsedDate))
    .range([0, innerWidth]);
  const allValues = series.flatMap((entry) => [entry.actualPrice, entry.counterfactualPrice]);
  const extent = d3.extent(allValues);
  const padding = Math.max(0.1, (extent[1] - extent[0]) * 0.15);
  const y = d3
    .scaleLinear()
    .domain([Math.max(0, extent[0] - padding), extent[1] + padding])
    .nice()
    .range([innerHeight, 0]);

  elements.estimateChart.replaceChildren();
  const svg = d3
    .select(elements.estimateChart)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("aria-hidden", "true");
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  plot
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""));
  plot
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(Math.min(series.length, width < 620 ? 4 : 8))
        .tickFormat(d3.utcFormat("%b %Y"))
        .tickSizeOuter(0),
    );
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat((value) => `$${value.toFixed(2)}`));

  const actualLine = d3
    .line()
    .x((entry) => x(entry.parsedDate))
    .y((entry) => y(entry.actualPrice));
  const counterfactualLine = d3
    .line()
    .x((entry) => x(entry.parsedDate))
    .y((entry) => y(entry.counterfactualPrice));
  const differenceArea = d3
    .area()
    .x((entry) => x(entry.parsedDate))
    .y0((entry) => y(entry.actualPrice))
    .y1((entry) => y(entry.counterfactualPrice));
  plot.append("path").datum(series).attr("class", "difference-area").attr("d", differenceArea);
  plot.append("path").datum(series).attr("class", "actual-line").attr("d", actualLine);
  plot
    .append("path")
    .datum(series)
    .attr("class", "counterfactual-line")
    .attr("d", counterfactualLine);
  plot
    .selectAll(".actual-dot")
    .data(series)
    .join("circle")
    .attr("class", "actual-dot")
    .attr("r", 3.5)
    .attr("cx", (entry) => x(entry.parsedDate))
    .attr("cy", (entry) => y(entry.actualPrice));
  plot
    .selectAll(".counterfactual-dot")
    .data(series)
    .join("circle")
    .attr("class", "counterfactual-dot")
    .attr("r", 3.5)
    .attr("cx", (entry) => x(entry.parsedDate))
    .attr("cy", (entry) => y(entry.counterfactualPrice));

  const bisect = d3.bisector((entry) => entry.parsedDate).center;
  const focusLine = plot.append("line").attr("class", "focus-line").attr("y1", 0).attr("y2", innerHeight).style("opacity", 0);
  function hidePoint() {
    focusLine.style("opacity", 0);
    elements.tooltip.classList.remove("visible");
  }
  plot
    .append("rect")
    .attr("class", "chart-overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .on("mousemove", (event) => {
      const [pointerX] = d3.pointer(event);
      const entry = series[bisect(series, x.invert(pointerX))];
      focusLine.attr("x1", x(entry.parsedDate)).attr("x2", x(entry.parsedDate)).style("opacity", 1);
      elements.tooltip.innerHTML = `<strong>${monthDate.format(entry.parsedDate)}</strong><span>Actual: ${price.format(entry.actualPrice)}</span><span>Expected: ${price.format(entry.counterfactualPrice)}</span><span>Diff: ${signedPrice.format(entry.actualPrice - entry.counterfactualPrice)} / gal</span><span>Total Diff: ${signedCurrency.format(entry.cumulativeDifference)}</span>`;
      elements.tooltip.style.left = `${event.clientX}px`;
      elements.tooltip.style.top = `${event.clientY}px`;
      elements.tooltip.classList.add("visible");
    })
    .on("mouseleave", hidePoint);
}

function populateControls() {
  const states = Object.keys(state.prices.states)
    .sort((left, right) => jurisdictionName(left).localeCompare(jurisdictionName(right)))
    .map((code) => ({ value: code, label: jurisdictionName(code) }));
  for (const { value, label } of states) {
    const historyOption = document.createElement("option");
    historyOption.value = value;
    historyOption.textContent = label;
    elements.historyJurisdiction.append(historyOption);

    const calculatorOption = document.createElement("option");
    calculatorOption.value = value;
    calculatorOption.textContent = label;
    elements.calculatorState.append(calculatorOption);
  }

  const makes = state.vehicleIndex.makes
    .filter((make) => make.withTankCapacity > 0)
    .map((make) => ({ value: make.slug, label: make.name }));
  setOptions(elements.make, makes, "Select a make");
  elements.make.disabled = false;
}

function bindEvents() {
  elements.historyJurisdiction.addEventListener("change", () => {
    updateHistoryGradeAvailability();
    renderHistoryChart();
  });
  elements.historyGrade.addEventListener("change", renderHistoryChart);
  elements.historyRanges.forEach((button) => {
    button.addEventListener("click", () => {
      state.historyRangeMonths = button.dataset.rangeMonths;
      elements.historyRanges.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderHistoryChart();
    });
  });
  elements.make.addEventListener("change", handleMakeChange);
  elements.model.addEventListener("change", handleModelChange);
  elements.year.addEventListener("change", handleYearChange);
  elements.variant.addEventListener("change", handleVariantChange);
  elements.calculatorState.addEventListener("change", updateEstimate);
  elements.calculatorGrade.addEventListener("change", updateEstimate);
  elements.fills.addEventListener("input", updateEstimate);
  elements.trend.addEventListener("input", updateEstimate);

  let resizeTimer;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.prices) {
        renderHistoryChart();
      }
      if (state.estimate) {
        renderEstimateChart(state.estimate);
      }
    }, 120);
  });
}

async function initialize() {
  if (!window.d3) {
    throw new Error("D3 could not be loaded");
  }
  const [pricesResponse, vehiclesResponse] = await Promise.all([
    fetch(`${DATA_ROOT}/prices/processed/prices.json`),
    fetch(`${DATA_ROOT}/vehicles/processed/index.json`),
  ]);
  if (!pricesResponse.ok || !vehiclesResponse.ok) {
    throw new Error("The processed data files could not be loaded");
  }
  [state.prices, state.vehicleIndex] = await Promise.all([
    pricesResponse.json(),
    vehiclesResponse.json(),
  ]);
  elements.priceUpdateDate.textContent = longDate.format(parseDate(state.prices.lastDate));

  populateControls();
  bindEvents();
  updateHistoryGradeAvailability();
  renderHistoryChart();
  resetEstimate();

}

initialize().catch((error) => {
  showEmptyChart(elements.historyChart, "Price data could not be loaded.");
  resetEstimate("Data unavailable");
  console.error(error);
});
