import { reportTables } from "./reporting.ts";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type { Dashboard } from "./metrics.ts";
export async function makePdf(d: Dashboard, organization: string) {
  const config = (d as any).report || {};
  organization = config.organization || organization;
  const report = reportTables(d, config);
  const doc = new PDFDocument({
    margin: 44,
    bufferPages: true,
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
  const room = (height: number) => {
    if (doc.y + height > 750) doc.addPage();
  };
  const line = (s: string, size = 10, color = "#334155") => {
    room(doc.fontSize(size).heightOfString(s, { width: 507 }) + 4);
    doc
      .fillColor(color)
      .fontSize(size)
      .text(s.replaceAll("→", "to").replaceAll("—", "-"), { lineGap: 4 });
  };
  if (config.logo) {
    try {
      doc.image(Buffer.from(config.logo, "base64"), 44, 44, { fit: [110, 45] });
      doc.y = 100;
    } catch {}
  }
  line(
    `${organization} / FIELDBOARD`,
    10,
    config.branding?.accent || "#047857",
  );
  line(
    config.branding?.reportTitle && config.title === undefined
      ? `${config.branding.reportTitle}: ${report.title}`
      : report.title,
    15,
    "#102332",
  );
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
  if (!config.sections || config.sections.includes("metrics")) {
    line("Verified project metrics", 15, "#102332");
    for (const m of d.metrics) {
      room(48);
      line(
        `${m.label}: ${m.value === null ? "No data" : m.value + " " + m.unit}`,
        11,
        "#102332",
      );
      line(m.coverage, 9);
    }
  }
  if (
    d.trend.length &&
    (!config.sections ||
      config.sections.includes("resources") ||
      config.sections.includes("productivity"))
  ) {
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
  for (const table of report.tables) {
    room(table.name === "Planned vs actual" ? 360 : 110);
    doc.moveDown();
    line(table.name, 18, "#102332");
    if (!table.rows.length) line("No records in this scope.");
    if (table.name === "Planned vs actual" && d.analysis?.curve.length) {
      const points = d.analysis.curve,
        left = 75,
        top = doc.y + 30,
        width = 440,
        height = 220;
      for (const value of [0, 25, 50, 75, 100]) {
        const y = top + height - (value / 100) * height;
        doc
          .fontSize(9)
          .fillColor("#334155")
          .text(`${value}%`, 44, y - 4, { width: 28 });
        doc
          .moveTo(left, y)
          .lineTo(left + width, y)
          .strokeColor("#e2e8f0")
          .lineWidth(0.5)
          .stroke();
      }
      for (const field of ["planned", "actual"] as const) {
        doc
          .strokeColor(field === "planned" ? "#6589a9" : "#047857")
          .lineWidth(2);
        if (field === "planned") doc.dash(5, { space: 3 });
        else doc.undash();
        let connected = false;
        points.forEach((point, i) => {
          const value = point[field];
          if (value === null) {
            if (connected) doc.stroke();
            connected = false;
            return;
          }
          const x = left + (i / Math.max(1, points.length - 1)) * width,
            y = top + height - (value / 100) * height;
          if (connected) doc.lineTo(x, y);
          else doc.moveTo(x, y);
          connected = true;
        });
        if (connected) doc.stroke();
      }
      doc.undash();
      doc
        .fontSize(9)
        .fillColor("#334155")
        .text(points[0].date, left, top + height + 10, { width: 100 });
      doc.text(points.at(-1)!.date, left + width - 75, top + height + 10, {
        width: 100,
      });
      doc.x = 44;
      doc.y = top + height + 40;
      line(
        "Dashed: planned baseline. Solid: verified progress. Gaps: missing evidence.",
        9,
      );
      continue;
    }
    for (const row of table.rows) {
      if (doc.y + 28 + table.columns.length * 14 > 750) doc.addPage();
      line(String(row[0]), 12, "#102332");
      for (let i = 1; i < table.columns.length; i++)
        line(`${table.columns[i]}: ${row[i]}`, 9);
      doc.moveDown(0.4);
    }
  }
  if (config.portfolio) {
    doc.addPage();
    line("Project portfolio rollup", 18, "#102332");
    for (const p of config.portfolio) {
      line(`${p.name} / ${p.customer}`, 12);
      line(`Health: ${p.health}; forecast: ${p.forecast || "Unconfirmed"}`);
      for (const m of p.metrics)
        line(`${m.label}: ${m.value ?? "No data"} ${m.unit}`, 9);
      doc.moveDown();
    }
  }
  if (config.branding?.reportFooter) {
    doc.moveDown();
    line(config.branding.reportFooter, 9);
  }
  if (!config.sections || config.sections.includes("evidence")) {
    doc.addPage();
    line("Calculation evidence", 18, "#102332");
    for (const m of d.metrics) {
      room(70);
      line(m.label, 12, "#102332");
      line(m.calculation, 9);
      line(`Sources: ${m.sourceRecordIds.join(", ") || "None"}`, 8);
      doc.moveDown(0.3);
    }
  }
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        `${organization}  |  ${report.title}  |  ${i + 1} / ${pages.count}`,
        44,
        doc.page.height - 26,
        { width: 507, align: "right", lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return ready;
}
export async function makeExcel(d: Dashboard, organization: string) {
  const config = (d as any).report || {};
  organization = config.organization || organization;
  const report = reportTables(d, config);
  const wb = new ExcelJS.Workbook();
  wb.creator = organization;
  wb.created = new Date(d.asOf);
  if (!config.sections || config.sections.includes("metrics")) {
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
  }
  if (
    !config.sections ||
    config.sections.includes("resources") ||
    config.sections.includes("productivity")
  ) {
    const trend = wb.addWorksheet("Labor by work date");
    trend.columns = [
      { header: "Work date", key: "date", width: 20 },
      { header: "Approved field hours", key: "hours", width: 25 },
    ];
    d.trend.forEach((point) =>
      trend.addRow({ date: point.date, hours: point.hours }),
    );
  }
  for (const table of report.tables) {
    const s = wb.addWorksheet(table.name.slice(0, 31));
    s.columns = table.columns.map((header) => ({ header, width: 25 }));
    table.rows.forEach((row) => s.addRow(row));
  }
  if (config.portfolio) {
    const s = wb.addWorksheet("Portfolio");
    s.addRow([
      "Project",
      "Customer",
      "Health",
      "Forecast",
      "Metric",
      "Value",
      "Unit",
    ]);
    for (const p of config.portfolio)
      for (const m of p.metrics)
        s.addRow([
          p.name,
          p.customer,
          p.health,
          p.forecast,
          m.label,
          m.value ?? "No data",
          m.unit,
        ]);
  }
  const meta = wb.addWorksheet("Snapshot");
  for (const [k, v] of Object.entries({
    organization,
    reportTitle: report.title,
    footer: config.branding?.reportFooter || "",
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
  if (!config.sections || config.sections.includes("evidence")) {
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
