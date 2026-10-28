let current = null, timer = null, paused = false;
let previous = new Map();           // rowKey -> JSON of row (for change highlighting)

const $ = (id) => document.getElementById(id);

function setStatus(text, state) {
  $("status").textContent = text;
  $("dot").className = "dot" + (state ? " " + state : "");
}

async function getJSON(url) {
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

async function loadTabs() {
  const data = await getJSON("/api/tables");
  $("db").textContent = "· " + data.database;
  if (!current && data.tables.length) current = data.tables[0].name;
  $("tabs").innerHTML = "";
  for (const t of data.tables) {
    const b = document.createElement("button");
    b.className = t.name === current ? "active" : "";
    b.innerHTML = `${esc(t.name)}<span class="count">${t.rows}</span>`;
    b.onclick = () => { current = t.name; previous = new Map(); refresh(true); };
    $("tabs").appendChild(b);
  }
}

function esc(v) {
  return String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderTable(data, firstLoad) {
  if (!data.rows.length) {
    $("view").innerHTML = `<div class="empty">Table <b>${esc(data.table)}</b> is empty.</div>`;
    previous = new Map();
    return;
  }
  const cols = data.columns;
  const keyOf = (row, i) => data.primaryKey ? String(row[data.primaryKey]) : String(i);
  let html = "<table><thead><tr>";
  for (const c of cols) html += `<th>${esc(c.name)}${c.key === "PRI" ? " 🔑" : ""}<small>${esc(c.type)}</small></th>`;
  html += "</tr></thead><tbody>";

  const next = new Map();
  data.rows.forEach((row, i) => {
    const k = keyOf(row, i), json = JSON.stringify(row);
    next.set(k, json);
    let cls = "";
    if (!firstLoad) {
      if (!previous.has(k)) cls = "new";
      else if (previous.get(k) !== json) cls = "changed";
    }
    html += `<tr class="${cls}">`;
    for (const c of cols) {
      const v = row[c.name];
      html += v === null ? `<td class="null">NULL</td>` : `<td>${esc(v)}</td>`;
    }
    html += "</tr>";
  });
  html += "</tbody></table>";
  $("view").innerHTML = html;
  previous = next;

  // fade highlights out
  setTimeout(() => document.querySelectorAll("tr.new, tr.changed")
    .forEach((tr) => tr.className = ""), 1500);
}

async function refresh(firstLoad = false) {
  try {
    await loadTabs();
    if (!current) { $("view").innerHTML = `<div class="empty">No tables in this database.</div>`; return; }
    const data = await getJSON("/api/table/" + encodeURIComponent(current));
    renderTable(data, firstLoad);
    setStatus("updated " + new Date().toLocaleTimeString(), paused ? "paused" : "");
  } catch (e) {
    setStatus("error", "err");
    $("view").innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

function schedule() {
  clearInterval(timer);
  if (!paused) timer = setInterval(() => refresh(false), Number($("interval").value));
}

$("interval").onchange = schedule;
$("pause").onclick = () => {
  paused = !paused;
  $("pause").textContent = paused ? "Resume" : "Pause";
  setStatus(paused ? "paused" : "live", paused ? "paused" : "");
  schedule();
};

refresh(true).then(schedule);
