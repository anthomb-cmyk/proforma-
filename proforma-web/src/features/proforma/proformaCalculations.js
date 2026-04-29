import {
  DEFAULT_CAPEX,
  DEFAULT_FINANCING_ASSUMPTIONS,
  DEFAULT_OPERATING_ASSUMPTIONS,
  EXPENSE_ASSUMPTION_DEFAULTS,
  getCityTga,
} from "./proformaDefaults.js";

export function num(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export function money(value) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(num(value));
}

export function pct(value) {
  return `${(num(value) * 100).toFixed(2)}%`;
}

export function annualDebtService(loanAmount, annualRate, amortizationYears) {
  const principal = num(loanAmount);
  const rate = num(annualRate);
  const years = num(amortizationYears);
  if (!principal || !years) return 0;
  const monthlyRate = rate / 12;
  const months = years * 12;
  if (!monthlyRate) return principal / years;
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  return payment * 12;
}

export function welcomeTaxEstimate(purchasePrice) {
  const price = num(purchasePrice);
  if (!price) return 0;
  // Quebec welcome tax basic approximation. City-specific brackets can be added later.
  const bracket1 = Math.min(price, 58900) * 0.005;
  const bracket2 = Math.max(Math.min(price, 294600) - 58900, 0) * 0.01;
  const bracket3 = Math.max(price - 294600, 0) * 0.015;
  return bracket1 + bracket2 + bracket3;
}

export function estimateExpenses(input) {
  const assumptions = {
    ...EXPENSE_ASSUMPTION_DEFAULTS.default,
    ...(input.expenseAssumptions || {}),
  };
  const purchasePrice = num(input.purchasePrice);
  const units = num(input.unitsCount);
  const assessment = num(input.municipalAssessment) || purchasePrice * num(assumptions.assessmentRatio, 0.9);
  const suggestedMunicipalTaxes = assessment * num(assumptions.municipalTaxRate, 0.0125);
  const suggestedSchoolTaxes = assessment * num(assumptions.schoolTaxRate, 0.0009);
  const suggestedInsurance = Math.max(units * num(assumptions.insurancePerUnit, 600), num(assumptions.insuranceMinimum, 2500));

  return {
    estimatedAssessment: assessment,
    suggestedMunicipalTaxes,
    suggestedSchoolTaxes,
    suggestedInsurance,
  };
}

export function calculateProforma(input) {
  const operating = { ...DEFAULT_OPERATING_ASSUMPTIONS, ...(input.operating || {}) };
  const financing = { ...DEFAULT_FINANCING_ASSUMPTIONS, ...(input.financing || {}) };
  const capexDefaults = { ...DEFAULT_CAPEX, ...(input.capex || {}) };

  const units = num(input.unitsCount) || (input.units || []).length;
  const purchasePrice = num(input.purchasePrice);
  const sqftTotal = num(input.totalSqft) || num(input.floors) * num(input.sqftPerFloor);
  const rents = input.units || [];

  const actualMonthlyRevenue = rents.reduce((sum, row) => sum + num(row.currentRent), 0);
  const optimizedMonthlyRevenue = rents.reduce((sum, row) => sum + num(row.optimizedRent), 0);
  const actualAnnualRevenue = actualMonthlyRevenue * 12;
  const optimizedAnnualRevenue = optimizedMonthlyRevenue * 12;

  const expenseEstimate = estimateExpenses(input);
  const municipalTaxes = input.municipalTaxesOverridden ? num(input.municipalTaxes) : num(input.municipalTaxes, expenseEstimate.suggestedMunicipalTaxes);
  const schoolTaxes = input.schoolTaxesOverridden ? num(input.schoolTaxes) : num(input.schoolTaxes, expenseEstimate.suggestedSchoolTaxes);
  const insurance = input.insuranceOverridden ? num(input.insurance) : num(input.insurance, expenseEstimate.suggestedInsurance);
  const gas = num(input.gas);
  const hydro = num(input.hydro);
  const snowRemoval = num(input.snowRemoval);
  const concierge = num(input.concierge);
  const otherExpenses = num(input.otherExpenses);

  const baseOperatingExpenses = municipalTaxes + schoolTaxes + insurance + gas + hydro + snowRemoval + concierge + otherExpenses;
  const noiBeforeNormalization = actualAnnualRevenue - baseOperatingExpenses;

  const vacancy = actualAnnualRevenue * num(operating.vacancyRate);
  const maintenance = units * num(operating.maintenancePerUnit);
  const salaries = units * num(operating.salaryPerUnit);
  const management = actualAnnualRevenue * num(operating.managementRate);
  const normalizedExpenses = baseOperatingExpenses + vacancy + maintenance + salaries + management;
  const normalizedNoi = actualAnnualRevenue - normalizedExpenses;

  const optimizedVacancy = optimizedAnnualRevenue * num(operating.vacancyRate);
  const optimizedManagement = optimizedAnnualRevenue * num(operating.managementRate);
  const optimizedNormalizedExpenses = baseOperatingExpenses + optimizedVacancy + maintenance + salaries + optimizedManagement;
  const optimizedNoi = optimizedAnnualRevenue - optimizedNormalizedExpenses;

  const legalFees = num(financing.legalFees);
  const inspection = num(financing.inspection);
  const evaluation = num(financing.evaluation);
  const environmentals = num(financing.environmentals);
  const welcomeTax = num(financing.welcomeTax) || welcomeTaxEstimate(purchasePrice);
  const acquisitionCosts = legalFees + inspection + evaluation + environmentals + welcomeTax;

  const loanAmount = num(financing.loanAmount) || purchasePrice * num(financing.ltv);
  const cashDown = Math.max(purchasePrice - loanAmount, 0);
  const annualDebt = annualDebtService(loanAmount, num(financing.interestRate), num(financing.amortizationYears));
  const monthlyDebt = annualDebt / 12;

  const renoCost = units * num(capexDefaults.renoCostPerUnit);
  const buyOut = units * num(capexDefaults.buyOutPerUnit);
  const thermoPumps = units * num(capexDefaults.thermoPumpsPerUnit);
  const totalCapex = renoCost + buyOut + thermoPumps;
  const totalRequiredFunds = cashDown + acquisitionCosts + totalCapex;

  const tga = input.tga || getCityTga(input.city).base;
  const refiValue = optimizedNoi && tga ? optimizedNoi / tga : 0;
  const refiLoan = refiValue * num(input.refiLtv, 0.95);
  const cashProceedsAtRefi = Math.max(refiLoan - loanAmount, 0);
  const equityCreated = Math.max(refiValue - purchasePrice - totalCapex - acquisitionCosts, 0);

  return {
    units,
    sqftTotal,
    pricePerUnit: units ? purchasePrice / units : 0,
    pricePerSqft: sqftTotal ? purchasePrice / sqftTotal : 0,
    actualMonthlyRevenue,
    actualAnnualRevenue,
    optimizedMonthlyRevenue,
    optimizedAnnualRevenue,
    percentIncrease: actualAnnualRevenue ? (optimizedAnnualRevenue - actualAnnualRevenue) / actualAnnualRevenue : 0,
    ...expenseEstimate,
    municipalTaxes,
    schoolTaxes,
    insurance,
    baseOperatingExpenses,
    noiBeforeNormalization,
    vacancy,
    maintenance,
    salaries,
    management,
    normalizedExpenses,
    normalizedNoi,
    optimizedNoi,
    legalFees,
    inspection,
    evaluation,
    environmentals,
    welcomeTax,
    acquisitionCosts,
    loanAmount,
    cashDown,
    annualDebt,
    monthlyDebt,
    renoCost,
    buyOut,
    thermoPumps,
    totalCapex,
    totalRequiredFunds,
    tga,
    refiValue,
    refiLoan,
    cashProceedsAtRefi,
    equityCreated,
  };
}
