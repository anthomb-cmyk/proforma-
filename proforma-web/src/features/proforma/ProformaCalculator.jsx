import React, { useMemo, useState } from "react";
import { calculateProforma, money, pct, num } from "./proformaCalculations.js";
import { DEFAULT_CAPEX, DEFAULT_FINANCING_ASSUMPTIONS, DEFAULT_OPERATING_ASSUMPTIONS, CITY_TGA_DEFAULTS, getCityTga, getMarketRent } from "./proformaDefaults.js";
import "./proformaCalculator.css";

const UNIT_TYPES = ["1 1/2", "2 1/2", "3 1/2", "4 1/2", "5 1/2"];
const CITY_OPTIONS = Object.keys(CITY_TGA_DEFAULTS).sort((a, b) => a.localeCompare(b, "fr"));

function buildUnits(count, city, existing = []) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const prev = existing[i] || {};
    const unitType = prev.unitType || "4 1/2";
    rows.push({
      id: prev.id || `unit-${i + 1}`,
      unitNumber: prev.unitNumber || String(i + 1),
      unitType,
      currentRent: prev.currentRent || "",
      optimizedRent: prev.optimizedRent || getMarketRent(city, unitType) || "",
      notes: prev.notes || "",
    });
  }
  return rows;
}

function Field({ label, value, onChange, type = "text", hint }) {
  return (
    <label className="pf-field">
      <span>{label}</span>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`pf-metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ProformaCalculator() {
  const [data, setData] = useState(() => {
    const city = "Trois-Rivières";
    const unitsCount = 10;
    return {
      address: "",
      city,
      propertyType: "Résidentiel",
      unitsCount,
      purchasePrice: "700000",
      floors: "3",
      sqftPerFloor: "",
      totalSqft: "",
      municipalAssessment: "",
      municipalTaxes: "",
      schoolTaxes: "",
      insurance: "",
      municipalTaxesOverridden: false,
      schoolTaxesOverridden: false,
      insuranceOverridden: false,
      gas: "0",
      hydro: "0",
      snowRemoval: "0",
      concierge: "0",
      otherExpenses: "0",
      operating: { ...DEFAULT_OPERATING_ASSUMPTIONS },
      financing: { ...DEFAULT_FINANCING_ASSUMPTIONS },
      capex: { ...DEFAULT_CAPEX },
      tga: getCityTga(city).base,
      refiLtv: 0.95,
      units: buildUnits(unitsCount, city),
    };
  });

  const results = useMemo(() => calculateProforma(data), [data]);
  const cityTga = getCityTga(data.city);

  const patch = (changes) => setData((prev) => ({ ...prev, ...changes }));
  const patchNested = (key, changes) => setData((prev) => ({ ...prev, [key]: { ...prev[key], ...changes } }));

  const updateCity = (city) => {
    setData((prev) => ({
      ...prev,
      city,
      tga: getCityTga(city).base,
      units: prev.units.map((row) => ({
        ...row,
        optimizedRent: row.optimizedRent || getMarketRent(city, row.unitType) || "",
      })),
    }));
  };

  const updateUnitCount = (value) => {
    const count = Math.max(0, Math.min(100, num(value)));
    setData((prev) => ({ ...prev, unitsCount: value, units: buildUnits(count, prev.city, prev.units) }));
  };

  const updateUnit = (index, changes) => {
    setData((prev) => {
      const units = prev.units.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...changes };
        if (changes.unitType && !row.optimizedRent) {
          next.optimizedRent = getMarketRent(prev.city, changes.unitType) || "";
        }
        return next;
      });
      return { ...prev, units };
    });
  };

  const acceptSuggestedExpenses = () => {
    patch({
      municipalTaxes: Math.round(results.suggestedMunicipalTaxes),
      schoolTaxes: Math.round(results.suggestedSchoolTaxes),
      insurance: Math.round(results.suggestedInsurance),
      municipalTaxesOverridden: false,
      schoolTaxesOverridden: false,
      insuranceOverridden: false,
    });
  };

  return (
    <main className="pf-page">
      <header className="pf-hero">
        <div>
          <p className="pf-eyebrow">Standalone module</p>
          <h1>Proforma Lab</h1>
          <p>Fast deal calculator with saved defaults. Later this becomes a deal tab and exports Zach's Excel template.</p>
        </div>
        <div className="pf-hero-actions">
          <button type="button" onClick={acceptSuggestedExpenses}>Use suggested expenses</button>
          <button type="button" className="secondary" disabled>Excel export later</button>
        </div>
      </header>

      <section className="pf-grid pf-summary-grid">
        <Metric label="Actual annual revenue" value={money(results.actualAnnualRevenue)} />
        <Metric label="Optimized annual revenue" value={money(results.optimizedAnnualRevenue)} tone="good" />
        <Metric label="Normalized NOI" value={money(results.normalizedNoi)} />
        <Metric label="Optimized NOI" value={money(results.optimizedNoi)} tone="good" />
        <Metric label="Refi value" value={money(results.refiValue)} />
        <Metric label="Total required funds" value={money(results.totalRequiredFunds)} />
      </section>

      <div className="pf-layout">
        <section className="pf-card">
          <h2>1. Property</h2>
          <div className="pf-form-grid">
            <Field label="Address" value={data.address} onChange={(v) => patch({ address: v })} />
            <label className="pf-field">
              <span>City</span>
              <select value={data.city} onChange={(e) => updateCity(e.target.value)}>
                {CITY_OPTIONS.map((city) => <option key={city} value={city}>{city}</option>)}
              </select>
            </label>
            <Field label="Purchase price" value={data.purchasePrice} onChange={(v) => patch({ purchasePrice: v })} type="number" />
            <Field label="Units" value={data.unitsCount} onChange={updateUnitCount} type="number" />
            <Field label="Floors" value={data.floors} onChange={(v) => patch({ floors: v })} type="number" />
            <Field label="SQFT / floor" value={data.sqftPerFloor} onChange={(v) => patch({ sqftPerFloor: v })} type="number" />
            <Field label="Total SQFT" value={data.totalSqft} onChange={(v) => patch({ totalSqft: v })} type="number" hint="Optional override" />
            <Field label="Property type" value={data.propertyType} onChange={(v) => patch({ propertyType: v })} />
          </div>
          <div className="pf-mini-results">
            <span>Price/unit: <strong>{money(results.pricePerUnit)}</strong></span>
            <span>Price/SQFT: <strong>{money(results.pricePerSqft)}</strong></span>
          </div>
        </section>

        <section className="pf-card">
          <h2>2. Refi TGA</h2>
          <p className="pf-muted">Base TGA auto-fills from the city. Keep editable because it changes by market and appraiser.</p>
          <div className="pf-tga-row">
            <button type="button" onClick={() => patch({ tga: cityTga.aggressive })}>Aggressive {pct(cityTga.aggressive)}</button>
            <button type="button" onClick={() => patch({ tga: cityTga.base })}>Base {pct(cityTga.base)}</button>
            <button type="button" onClick={() => patch({ tga: cityTga.conservative })}>Conservative {pct(cityTga.conservative)}</button>
          </div>
          <div className="pf-form-grid two">
            <Field label="TGA used" value={data.tga} onChange={(v) => patch({ tga: num(v) > 1 ? num(v) / 100 : v })} type="number" />
            <Field label="Refi LTV" value={data.refiLtv} onChange={(v) => patch({ refiLtv: num(v) > 1 ? num(v) / 100 : v })} type="number" />
          </div>
          <div className="pf-mini-results stacked">
            <span>Value @ aggressive: <strong>{money(results.optimizedNoi / cityTga.aggressive)}</strong></span>
            <span>Value @ base: <strong>{money(results.optimizedNoi / cityTga.base)}</strong></span>
            <span>Value @ conservative: <strong>{money(results.optimizedNoi / cityTga.conservative)}</strong></span>
          </div>
        </section>

        <section className="pf-card wide">
          <h2>3. Rent roll</h2>
          <div className="pf-table">
            <div className="pf-table-head rent"><span>Unit</span><span>Type</span><span>Current rent</span><span>Optimized rent</span><span>Notes</span></div>
            {data.units.map((row, index) => (
              <div className="pf-table-row rent" key={row.id || index}>
                <input value={row.unitNumber} onChange={(e) => updateUnit(index, { unitNumber: e.target.value })} />
                <select value={row.unitType} onChange={(e) => updateUnit(index, { unitType: e.target.value })}>
                  {UNIT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <input type="number" value={row.currentRent} onChange={(e) => updateUnit(index, { currentRent: e.target.value })} />
                <input type="number" value={row.optimizedRent} onChange={(e) => updateUnit(index, { optimizedRent: e.target.value })} />
                <input value={row.notes} onChange={(e) => updateUnit(index, { notes: e.target.value })} />
              </div>
            ))}
          </div>
        </section>

        <section className="pf-card">
          <h2>4. Expenses</h2>
          <p className="pf-muted">Municipal taxes, school taxes and insurance are suggested. User can override.</p>
          <div className="pf-form-grid two">
            <Field label="Municipal assessment" value={data.municipalAssessment} onChange={(v) => patch({ municipalAssessment: v })} type="number" hint={`Estimated: ${money(results.estimatedAssessment)}`} />
            <Field label="Municipal taxes" value={data.municipalTaxes || Math.round(results.suggestedMunicipalTaxes)} onChange={(v) => patch({ municipalTaxes: v, municipalTaxesOverridden: true })} type="number" hint={`Suggested: ${money(results.suggestedMunicipalTaxes)}`} />
            <Field label="School taxes" value={data.schoolTaxes || Math.round(results.suggestedSchoolTaxes)} onChange={(v) => patch({ schoolTaxes: v, schoolTaxesOverridden: true })} type="number" hint={`Suggested: ${money(results.suggestedSchoolTaxes)}`} />
            <Field label="Insurance" value={data.insurance || Math.round(results.suggestedInsurance)} onChange={(v) => patch({ insurance: v, insuranceOverridden: true })} type="number" hint={`Suggested: ${money(results.suggestedInsurance)}`} />
            <Field label="Gas / hot water" value={data.gas} onChange={(v) => patch({ gas: v })} type="number" />
            <Field label="Hydro common" value={data.hydro} onChange={(v) => patch({ hydro: v })} type="number" />
            <Field label="Snow removal" value={data.snowRemoval} onChange={(v) => patch({ snowRemoval: v })} type="number" />
            <Field label="Concierge" value={data.concierge} onChange={(v) => patch({ concierge: v })} type="number" />
          </div>
        </section>

        <section className="pf-card">
          <h2>5. Normalization defaults</h2>
          <p className="pf-muted">These stay the same most of the time. Editable, but not required every deal.</p>
          <div className="pf-form-grid two">
            <Field label="Vacancy rate" value={data.operating.vacancyRate} onChange={(v) => patchNested("operating", { vacancyRate: num(v) > 1 ? num(v) / 100 : v })} type="number" />
            <Field label="Maintenance / unit" value={data.operating.maintenancePerUnit} onChange={(v) => patchNested("operating", { maintenancePerUnit: v })} type="number" />
            <Field label="Salary / unit" value={data.operating.salaryPerUnit} onChange={(v) => patchNested("operating", { salaryPerUnit: v })} type="number" />
            <Field label="Management rate" value={data.operating.managementRate} onChange={(v) => patchNested("operating", { managementRate: num(v) > 1 ? num(v) / 100 : v })} type="number" />
          </div>
        </section>

        <section className="pf-card">
          <h2>6. CAPEX defaults</h2>
          <p className="pf-muted">Defaults update automatically from unit count. Edit only if this deal is different.</p>
          <div className="pf-table compact">
            <div className="pf-table-head capex"><span>Item</span><span>Per unit</span><span>Total</span></div>
            <div className="pf-table-row capex"><span>Reno Cost</span><input type="number" value={data.capex.renoCostPerUnit} onChange={(e) => patchNested("capex", { renoCostPerUnit: e.target.value })} /><strong>{money(results.renoCost)}</strong></div>
            <div className="pf-table-row capex"><span>Buy-Out</span><input type="number" value={data.capex.buyOutPerUnit} onChange={(e) => patchNested("capex", { buyOutPerUnit: e.target.value })} /><strong>{money(results.buyOut)}</strong></div>
            <div className="pf-table-row capex"><span>Thermo-Pompes</span><input type="number" value={data.capex.thermoPumpsPerUnit} onChange={(e) => patchNested("capex", { thermoPumpsPerUnit: e.target.value })} /><strong>{money(results.thermoPumps)}</strong></div>
          </div>
          <div className="pf-total-line"><span>Total CAPEX</span><strong>{money(results.totalCapex)}</strong></div>
        </section>

        <section className="pf-card">
          <h2>7. Financing</h2>
          <div className="pf-form-grid two">
            <Field label="LTV" value={data.financing.ltv} onChange={(v) => patchNested("financing", { ltv: num(v) > 1 ? num(v) / 100 : v })} type="number" />
            <Field label="Interest rate" value={data.financing.interestRate} onChange={(v) => patchNested("financing", { interestRate: num(v) > 1 ? num(v) / 100 : v })} type="number" />
            <Field label="Amortization" value={data.financing.amortizationYears} onChange={(v) => patchNested("financing", { amortizationYears: v })} type="number" />
            <Field label="Seller financing" value={data.financing.sellerFinancingAmount} onChange={(v) => patchNested("financing", { sellerFinancingAmount: v })} type="number" />
            <Field label="Legal fees" value={data.financing.legalFees} onChange={(v) => patchNested("financing", { legalFees: v })} type="number" />
            <Field label="Inspection" value={data.financing.inspection} onChange={(v) => patchNested("financing", { inspection: v })} type="number" />
            <Field label="Evaluation" value={data.financing.evaluation} onChange={(v) => patchNested("financing", { evaluation: v })} type="number" />
            <Field label="Environmentals" value={data.financing.environmentals} onChange={(v) => patchNested("financing", { environmentals: v })} type="number" />
          </div>
        </section>

        <section className="pf-card wide">
          <h2>8. Deal output</h2>
          <div className="pf-grid pf-output-grid">
            <Metric label="Loan amount" value={money(results.loanAmount)} />
            <Metric label="Cash down" value={money(results.cashDown)} />
            <Metric label="Closing costs" value={money(results.acquisitionCosts)} />
            <Metric label="Monthly debt" value={money(results.monthlyDebt)} />
            <Metric label="NOI before normalization" value={money(results.noiBeforeNormalization)} />
            <Metric label="Revenue upside" value={pct(results.percentIncrease)} tone="good" />
            <Metric label="Refi loan" value={money(results.refiLoan)} />
            <Metric label="Cash proceeds at refi" value={money(results.cashProceedsAtRefi)} />
            <Metric label="Estimated equity created" value={money(results.equityCreated)} tone="good" />
          </div>
        </section>
      </div>
    </main>
  );
}
