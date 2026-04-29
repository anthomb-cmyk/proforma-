export const DEFAULT_CAPEX = {
  renoCostPerUnit: 10000,
  buyOutPerUnit: 5000,
  thermoPumpsPerUnit: 2500,
};

export const DEFAULT_OPERATING_ASSUMPTIONS = {
  vacancyRate: 0.03,
  maintenancePerUnit: 610,
  salaryPerUnit: 365,
  managementRate: 0.0425,
};

export const DEFAULT_FINANCING_ASSUMPTIONS = {
  ltv: 0.8,
  interestRate: 0.051,
  amortizationYears: 25,
  sellerFinancingAmount: 0,
  sellerFinancingRate: 0.075,
  legalFees: 2000,
  inspection: 1500,
  evaluation: 2000,
  environmentals: 0,
};

// Working refi TGA defaults. These are underwriting defaults, not appraiser guarantees.
// Use base for normal analysis and show aggressive/conservative as sensitivity.
export const CITY_TGA_DEFAULTS = {
  "Montréal": { aggressive: 0.0475, base: 0.0525, conservative: 0.0575 },
  "Montréal Prime": { aggressive: 0.045, base: 0.0475, conservative: 0.0525 },
  "Plateau-Mont-Royal": { aggressive: 0.04, base: 0.045, conservative: 0.05 },
  "Rosemont": { aggressive: 0.0425, base: 0.0475, conservative: 0.0525 },
  "Laval": { aggressive: 0.05, base: 0.0525, conservative: 0.0575 },
  "Longueuil": { aggressive: 0.05, base: 0.0525, conservative: 0.0575 },
  "Brossard": { aggressive: 0.049, base: 0.0515, conservative: 0.056 },
  "Saint-Lambert": { aggressive: 0.0475, base: 0.05, conservative: 0.055 },
  "Saint-Hubert": { aggressive: 0.05, base: 0.0535, conservative: 0.0585 },
  "Greenfield Park": { aggressive: 0.05, base: 0.0535, conservative: 0.0585 },
  "Chambly": { aggressive: 0.0525, base: 0.055, conservative: 0.06 },
  "Saint-Jean-sur-Richelieu": { aggressive: 0.055, base: 0.0575, conservative: 0.0625 },
  "Saint-Hyacinthe": { aggressive: 0.055, base: 0.0575, conservative: 0.0625 },
  "Granby": { aggressive: 0.0575, base: 0.06, conservative: 0.065 },
  "Cowansville": { aggressive: 0.06, base: 0.0625, conservative: 0.0675 },
  "Waterloo": { aggressive: 0.0625, base: 0.065, conservative: 0.07 },
  "Sherbrooke": { aggressive: 0.06, base: 0.0625, conservative: 0.07 },
  "Magog": { aggressive: 0.0575, base: 0.06, conservative: 0.0675 },
  "Trois-Rivières": { aggressive: 0.06, base: 0.065, conservative: 0.0725 },
  "Shawinigan": { aggressive: 0.0675, base: 0.07, conservative: 0.0775 },
  "Victoriaville": { aggressive: 0.0625, base: 0.065, conservative: 0.0725 },
  "Drummondville": { aggressive: 0.06, base: 0.0625, conservative: 0.07 },
  "Québec": { aggressive: 0.0525, base: 0.0575, conservative: 0.0625 },
  "Lévis": { aggressive: 0.055, base: 0.0585, conservative: 0.065 },
  "Gatineau": { aggressive: 0.0525, base: 0.0575, conservative: 0.0625 },
  "Terrebonne": { aggressive: 0.0525, base: 0.055, conservative: 0.06 },
  "Repentigny": { aggressive: 0.0525, base: 0.056, conservative: 0.061 },
  "Mirabel": { aggressive: 0.055, base: 0.0575, conservative: 0.0625 },
  "Saint-Jérôme": { aggressive: 0.0575, base: 0.06, conservative: 0.065 },
  "Joliette": { aggressive: 0.06, base: 0.0625, conservative: 0.07 },
  "Sorel-Tracy": { aggressive: 0.065, base: 0.0675, conservative: 0.075 },
  "Salaberry-de-Valleyfield": { aggressive: 0.06, base: 0.0625, conservative: 0.07 },
  "Saguenay": { aggressive: 0.065, base: 0.0675, conservative: 0.075 },
  "Rimouski": { aggressive: 0.0625, base: 0.065, conservative: 0.0725 },
  "Rouyn-Noranda": { aggressive: 0.0675, base: 0.07, conservative: 0.08 },
  "Val-d’Or": { aggressive: 0.0675, base: 0.07, conservative: 0.08 },
  "Thetford Mines": { aggressive: 0.07, base: 0.0725, conservative: 0.0825 },
  "Saint-Georges": { aggressive: 0.065, base: 0.0675, conservative: 0.075 },
  "Alma": { aggressive: 0.065, base: 0.0675, conservative: 0.075 },
  "Baie-Comeau": { aggressive: 0.0725, base: 0.075, conservative: 0.085 },
};

export const MARKET_RENT_DEFAULTS = {
  "Trois-Rivières": { "1 1/2": 725, "2 1/2": 825, "3 1/2": 950, "4 1/2": 1250, "5 1/2": 1500 },
  "Victoriaville": { "1 1/2": 700, "2 1/2": 800, "3 1/2": 925, "4 1/2": 1150, "5 1/2": 1350 },
  "Sherbrooke": { "1 1/2": 850, "2 1/2": 975, "3 1/2": 1150, "4 1/2": 1450, "5 1/2": 1700 },
  "Granby": { "1 1/2": 800, "2 1/2": 925, "3 1/2": 1075, "4 1/2": 1350, "5 1/2": 1600 },
  "Longueuil": { "1 1/2": 950, "2 1/2": 1125, "3 1/2": 1350, "4 1/2": 1650, "5 1/2": 1950 },
};

export const EXPENSE_ASSUMPTION_DEFAULTS = {
  default: {
    municipalTaxRate: 0.0125,
    schoolTaxRate: 0.0009,
    assessmentRatio: 0.9,
    insurancePerUnit: 600,
    insuranceMinimum: 2500,
  },
};

export function getCityTga(city) {
  return CITY_TGA_DEFAULTS[city] || { aggressive: 0.06, base: 0.065, conservative: 0.0725 };
}

export function getMarketRent(city, unitType) {
  return MARKET_RENT_DEFAULTS[city]?.[unitType] || 0;
}
