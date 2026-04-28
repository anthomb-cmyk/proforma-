// routes/contactEnrichment.test.js
//
// Lightweight test harness for the contactEnrichment route factory. Builds
// a minimal Express app, injects a mocked searchFn, exercises both /preview
// and /single without hitting the network.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createContactEnrichmentRouter } from "./contactEnrichment.js";

function startApp(deps) {
  const app = express();
  app.use(express.json());
  app.use("/api/contact-enrichment", createContactEnrichmentRouter(deps));
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function postJSON(port, path, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: "POST",
      hostname: "127.0.0.1",
      port,
      path,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => buf += c);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const okSearch = (results = []) => async () => ({ ok: true, results });
const notConfigured = () => async () => ({ ok: false, error: "WEB_SEARCH_NOT_CONFIGURED" });

const samplePkg = {
  lead_owner_name: "Test Inc.",
  legal_entity_category: "inc_ltee",
  search_strategy: "direct_entity",
  candidatePhones: [],
};

describe("POST /api/contact-enrichment/preview", () => {
  test("400 when packages[] missing", async () => {
    const { server, port } = await startApp({ createSearchFn: () => okSearch([]) });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/preview", {});
      assert.equal(r.status, 400);
      assert.equal(r.body.ok, false);
    } finally {
      server.close();
    }
  });

  test("503 when web search is not configured", async () => {
    const { server, port } = await startApp({ createSearchFn: notConfigured });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/preview", { packages: [samplePkg] });
      assert.equal(r.status, 503);
      assert.equal(r.body.error, "WEB_SEARCH_NOT_CONFIGURED");
    } finally {
      server.close();
    }
  });

  test("200 with results array on success", async () => {
    const { server, port } = await startApp({ createSearchFn: () => okSearch([]) });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/preview", { packages: [samplePkg], limit: 1 });
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.ok(Array.isArray(r.body.results));
      assert.equal(r.body.results.length, 1);
    } finally {
      server.close();
    }
  });
});

describe("POST /api/contact-enrichment/single", () => {
  test("400 when package missing", async () => {
    const { server, port } = await startApp({ createSearchFn: () => okSearch([]) });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/single", {});
      assert.equal(r.status, 400);
      assert.equal(r.body.ok, false);
    } finally {
      server.close();
    }
  });

  test("400 when package is an array (must be a single object)", async () => {
    const { server, port } = await startApp({ createSearchFn: () => okSearch([]) });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/single", { package: [samplePkg] });
      assert.equal(r.status, 400);
    } finally {
      server.close();
    }
  });

  test("503 when web search is not configured", async () => {
    const { server, port } = await startApp({ createSearchFn: notConfigured });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/single", { package: samplePkg });
      assert.equal(r.status, 503);
      assert.equal(r.body.error, "WEB_SEARCH_NOT_CONFIGURED");
    } finally {
      server.close();
    }
  });

  test("200 with a single result object on success", async () => {
    const { server, port } = await startApp({ createSearchFn: () => okSearch([]) });
    try {
      const r = await postJSON(port, "/api/contact-enrichment/single", { package: samplePkg });
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.ok(r.body.result, "result should be present");
      assert.ok(typeof r.body.result === "object" && !Array.isArray(r.body.result),
        "result should be a single object, not an array");
      assert.equal(r.body.result.lead_owner_name, "Test Inc.");
    } finally {
      server.close();
    }
  });
});
