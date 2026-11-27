import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type { Dashboard } from "./metrics.ts";
export async function makePdf(d: Dashboard, organization: string) {
  const doc = new PDFDocument({
    margin: 44,
    size: "A4",
    info: {
      Title: `${d.project.data.name} — project report`,
      Author: organization,
    },
  });
  const chunks: Buffer[] = [];
  const ready = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const line = (s: string, size = 10, color = "#334155") => {
    if (doc.y > 750) doc.addPage();
    doc
      .fillColor(color)
      .fontSize(size)
      .text(s.replaceAll("→", "to").replaceAll("—", "-"), { lineGap: 4 });
  };
  line(`${organization} / FIELDBOARD`, 10, "#047857");
  doc.moveDown();
  line(d.project.data.name, 23, "#102332");
  line(`${d.project.data.code} | ${d.project.data.customer}`, 11);
  doc.moveDown();
  line(`Snapshot: ${d.asOf}`);
  line(
    `Section: ${d.sections.find((s) => s.id === d.scope.sectionId)?.data.name || "All sections"} | Dates: ${d.scope.from || "Beginning"} to ${d.scope.to || "Latest"}`,
  );
  if (d.project.data.sample)
    line(
      "SAMPLE PROJECT — values are not live customer records",
      10,
      "#b45309",
    );
  doc.moveDown();
  line("Verified project metrics", 15, "#102332");
  for (const m of d.metrics) {
    line(
      `${m.label}: ${m.value === null ? "No data" : m.value + " " + m.unit}`,
      11,
      "#102332",
    );
    line(m.coverage, 9);
  }
  doc.moveDown();
  line("Milestones", 15, "#102332");
  for (const t of d.milestones)
    line(
      `${t.data.name} | Baseline: ${t.data.baselineFinish || "Unconfirmed"} | Forecast: ${t.data.forecastFinish || "Unconfirmed"}`,
    );
  doc.moveDown();
  line("Open issues and constraints", 15, "#102332");
  for (const i of d.issues.filter((i) => i.data.status === "open"))
    line(
      `${i.data.severity.toUpperCase()} / ${i.data.name} / ${i.data.owner || "Unassigned"}`,
    );
  if (!d.issues.some((i) => i.data.status === "open"))
    line("No open issues in this scope.");
  if (d.trend.length) {
    if (doc.y + 60 + Math.min(d.trend.length, 20) * 26 > 750) doc.addPage();
    else doc.moveDown();
    line("Approved field hours by work date", 18, "#102332");
    doc.moveDown();
    const max = Math.max(...d.trend.map((t) => t.hours), 1);
    for (const point of d.trend) {
      if (doc.y > 710) doc.addPage();
      const y = doc.y;
      doc.fillColor("#334155").fontSize(10).text(point.date, 44, y);
      doc
        .fillColor("#6f9f8a")
        .rect(135, y, Math.max(1, (point.hours / max) * 320), 12)
        .fill();
      doc.fillColor("#334155").text(`${point.hours} h`, 465, y);
      doc.x = 44;
      doc.y = y + 26;
    }
  }
  doc.addPage();
  line("Calculation evidence", 18, "#102332");
  for (const m of d.metrics) {
    line(m.label, 12, "#102332");
    line(m.calculation, 9);
    line(`Sources: ${m.sourceRecordIds.join(", ") || "None"}`, 8);
    doc.moveDown(0.3);
  }
  doc.end();
  return ready;
}
export async function makeExcel(d: Dashboard, organization: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = organization;
  wb.created = new Date(d.asOf);
  const sheet = wb.addWorksheet("Dashboard");
  sheet.columns = [
    { header: "Metric", key: "label", width: 30 },
    { header: "Value", key: "value", width: 18 },
    { header: "Unit", key: "unit", width: 14 },
    { header: "Coverage", key: "coverage", width: 75 },
    { header: "Calculation", key: "calculation", width: 55 },
    { header: "Source IDs", key: "sources", width: 65 },
  ];
  for (const m of d.metrics)
    sheet.addRow({
      ...m,
      value: m.value ?? "No data",
      sources: m.sourceRecordIds.join(", "),
    });
  const trend = wb.addWorksheet("Labor by work date");
  trend.columns = [
    { header: "Work date", key: "date", width: 20 },
    { header: "Approved field hours", key: "hours", width: 25 },
  ];
  d.trend.forEach((point) =>
    trend.addRow({ date: point.date, hours: point.hours }),
  );
  const meta = wb.addWorksheet("Snapshot");
  for (const [k, v] of Object.entries({
    organization,
    project: d.project.data.name,
    asOf: d.asOf,
    sample: d.project.data.sample,
    section: d.scope.sectionId || "All",
    from: d.scope.from || "",
    to: d.scope.to || "",
    projectVersion: d.project.version,
    baseline: d.project.data.baselineFinish,
    forecast: d.project.data.forecastFinish,
  }))
    meta.addRow([k, v]);
  meta.getColumn(1).width = 25;
  meta.getColumn(2).width = 70;
  for (const [name, records] of Object.entries({
    Tasks: d.tasks,
    Materials: d.materials,
    Issues: d.issues,
    "Approved time": d.reports.filter((r) => r.data.status === "approved"),
  })) {
    const s = wb.addWorksheet(name);
    const keys = [...new Set(records.flatMap((r) => Object.keys(r.data)))];
    s.columns = [
      { header: "Source ID", key: "id", width: 40 },
      { header: "Version", key: "version", width: 12 },
      ...keys.map((k) => ({ header: k, key: k, width: 25 })),
    ];
    for (const r of records)
      s.addRow({ id: r.id, version: r.version, ...r.data });
  }
  for (const s of wb.worksheets) {
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF102332" },
    };
    s.views = [{ state: "frozen", ySplit: 1 }];
    s.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
