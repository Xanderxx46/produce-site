(() => {
  const listEl = document.getElementById("edit-list");
  const countEl = document.getElementById("edit-count");
  const searchEl = document.getElementById("edit-search");
  const form = document.getElementById("add-form");
  const addError = document.getElementById("add-error");
  const addOk = document.getElementById("add-ok");
  const logoutBtn = document.getElementById("logout-btn");

  let items = [];
  let query = "";

  function upcPayload(plu) {
    return "0" + "00000" + String(plu).padStart(5, "0");
  }

  function catLabel(cat) {
    return { fruit: "Fruit", veg: "Veg", dry: "Dry" }[cat] || cat;
  }

  async function ensureAuth() {
    const res = await fetch("/api/me");
    const me = await res.json();
    if (!me.authenticated) {
      location.href = "/login.html?next=/edit";
      return false;
    }
    return true;
  }

  async function loadItems() {
    const res = await fetch("/api/items");
    items = await res.json();
    render();
  }

  function filtered() {
    return window.PLUSearch.searchItems(items, query, "all");
  }

  function render() {
    const rows = filtered();
    countEl.textContent = String(rows.length);
    listEl.innerHTML = rows
      .map(
        (item) => `
      <article class="edit-row" data-id="${item.id}">
        <div class="edit-row-main">
          <div>
            <h3 class="card-name">${escapeHtml(item.name)}</h3>
            <p class="edit-meta">${catLabel(item.cat)} · PLU ${escapeHtml(item.plu)}</p>
          </div>
          <p class="plu plu-sm">${escapeHtml(item.plu)}</p>
        </div>
        <div class="barcode-wrap barcode-sm">
          <svg class="barcode" data-code="${upcPayload(item.plu)}"></svg>
        </div>
        <button type="button" class="btn-danger" data-delete="${item.id}">Delete</button>
      </article>`
      )
      .join("");

    if (typeof JsBarcode !== "undefined") {
      listEl.querySelectorAll("svg.barcode").forEach((svg) => {
        try {
          JsBarcode(svg, svg.dataset.code, {
            format: "upc",
            width: 1.4,
            height: 40,
            displayValue: true,
            fontSize: 11,
            margin: 2,
            background: "#ffffff",
            lineColor: "#111111",
          });
        } catch {
          /* ignore bad PLU encode */
        }
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    const id = Number(btn.dataset.delete);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (!confirm(`Delete “${item.name}” (PLU ${item.plu})?`)) return;

    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Delete failed");
      return;
    }
    items = items.filter((i) => i.id !== id);
    render();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    addError.classList.add("hidden");
    addOk.classList.add("hidden");
    const data = new FormData(form);
    const payload = {
      name: data.get("name"),
      plu: data.get("plu"),
      cat: data.get("cat"),
    };

    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      addError.textContent = body.error || "Could not add item";
      addError.classList.remove("hidden");
      return;
    }

    form.reset();
    addOk.textContent = `Added ${body.name} (${body.plu})`;
    addOk.classList.remove("hidden");
    await loadItems();
  });

  let t;
  searchEl.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      query = searchEl.value.trim();
      render();
    }, 100);
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/";
  });

  (async () => {
    if (!(await ensureAuth())) return;
    await loadItems();
  })();
})();
