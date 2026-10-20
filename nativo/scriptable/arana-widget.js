// Araña · widget para Scriptable (hito h4)
// Muestra la araña, un saludo y la rutina que suele hacer a esta hora.
// Un toque abre la araña (con la rutina ya pedida, si la hay).
//
// Datos: en la araña, Evolución → «Copiar datos del widget», y péguelos en
// «Parámetro» al editar el widget. Sin datos, el widget funciona igual, solo saluda.
// No guarda claves ni lee nada del iPhone.

const SITE = "https://jrjr3333.github.io/arana/";
const INK = Color.dynamic(new Color("#1d1d1f"), new Color("#f5f5f7"));
const MUTED = Color.dynamic(new Color("#6e6e73"), new Color("#a1a1a6"));
const BG = Color.dynamic(new Color("#f5f5f7"), new Color("#1c1c1e"));
const ACCENT = new Color("#c0392b");

function readData() {
  const raw = (args.widgetParameter || "").trim();
  if (!raw) return { nombre: "", r: [] };
  try {
    const d = JSON.parse(raw);
    return { nombre: String(d.nombre || ""), r: Array.isArray(d.r) ? d.r : [] };
  } catch (e) {
    return { nombre: "", r: [], error: true };
  }
}

function suggestion(list, hour) {
  let best = null, bd = 99;
  for (const x of list) {
    if (typeof x.h !== "number" || !x.n) continue;
    const d = Math.min(Math.abs(x.h - hour), 24 - Math.abs(x.h - hour));
    if (d <= 1 && d < bd) { best = x; bd = d; }
  }
  return best;
}

function greeting(hour) {
  if (hour < 6 || hour >= 21) return "Buenas noches";
  if (hour < 13) return "Buenos días";
  return "Buenas tardes";
}

// La araña dibujada: cuerpo, cabeza y ocho patas de dos tramos.
function spider(size, color) {
  const c = new DrawContext();
  c.size = new Size(size, size);
  c.opaque = false;
  c.respectScreenScale = true;
  const cx = size / 2, cy = size / 2 + size * 0.04, k = size / 100;
  c.setStrokeColor(color);
  c.setLineWidth(3.2 * k);
  const angles = [-55, -20, 15, 50];
  for (const side of [-1, 1]) {
    for (const deg of angles) {
      const t = (deg * Math.PI) / 180;
      const knee = new Point(cx + side * Math.cos(t) * 26 * k, cy + Math.sin(t) * 26 * k - 10 * k);
      const foot = new Point(cx + side * Math.cos(t) * 44 * k, cy + Math.sin(t) * 44 * k + 8 * k);
      const p = new Path();
      p.move(new Point(cx, cy + 6 * k));
      p.addLine(knee);
      p.addLine(foot);
      c.addPath(p);
      c.strokePath();
    }
  }
  c.setFillColor(color);
  c.fillEllipse(new Rect(cx - 15 * k, cy - 6 * k, 30 * k, 34 * k));
  c.fillEllipse(new Rect(cx - 9 * k, cy - 22 * k, 18 * k, 18 * k));
  c.setFillColor(Color.white());
  c.fillEllipse(new Rect(cx - 6 * k, cy - 17 * k, 4.5 * k, 4.5 * k));
  c.fillEllipse(new Rect(cx + 1.5 * k, cy - 17 * k, 4.5 * k, 4.5 * k));
  // el hilo del que cuelga
  c.setStrokeColor(color);
  c.setLineWidth(1.2 * k);
  const h = new Path();
  h.move(new Point(cx, 0));
  h.addLine(new Point(cx, cy - 20 * k));
  c.addPath(h);
  c.strokePath();
  return c.getImage();
}

function build() {
  const d = readData();
  const now = new Date(), hour = now.getHours();
  const s = suggestion(d.r, hour);
  const fam = config.widgetFamily || "small";
  const w = new ListWidget();
  w.url = s ? SITE + "?q=" + encodeURIComponent(s.n) : SITE;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const hello = greeting(hour) + (d.nombre ? ", " + d.nombre : "") + ".";
  const line = s ? "A esta hora suele «" + s.n + "»." : d.error ? "Datos del widget no válidos." : "Toque para hablar conmigo.";

  if (fam === "accessoryInline") {
    w.addText(s ? "🕷 " + s.n : "🕷 Araña");
    return w;
  }
  if (fam === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const img = w.addImage(spider(60, Color.white()));
    img.centerAlignImage();
    return w;
  }
  if (fam === "accessoryRectangular") {
    const t = w.addText(s ? "Araña · " + String(s.h).padStart(2, "0") + ":00" : "Araña");
    t.font = Font.boldSystemFont(13);
    const u = w.addText(s ? s.n : hello);
    u.font = Font.systemFont(13);
    u.lineLimit = 2;
    return w;
  }

  w.backgroundColor = BG;
  w.setPadding(12, 12, 12, 12);
  const top = w.addStack();
  top.centerAlignContent();
  const img = top.addImage(spider(fam === "small" ? 46 : 54, INK));
  img.imageSize = fam === "small" ? new Size(46, 46) : new Size(54, 54);
  top.addSpacer(8);
  const t = top.addText(hello);
  t.font = Font.boldSystemFont(fam === "small" ? 14 : 16);
  t.textColor = INK;
  t.lineLimit = 2;
  w.addSpacer();
  const b = w.addText(line);
  b.font = Font.systemFont(fam === "small" ? 13 : 15);
  b.textColor = s ? INK : MUTED;
  b.lineLimit = 3;
  if (s) {
    w.addSpacer(4);
    const g = w.addText("Toque y lo hago");
    g.font = Font.semiboldSystemFont(11);
    g.textColor = ACCENT;
  }
  return w;
}

const widget = build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentSmall();
}
Script.complete();
