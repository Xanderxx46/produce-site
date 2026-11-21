(() => {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const countEl = document.getElementById("count");
  const search = document.getElementById("search");
  const catBtns = [...document.querySelectorAll(".cat-btn")];
  const editLink = document.getElementById("edit-link");

  let items = [];
  let activeCat = "all";
  let query = "";

  function upcPayload(plu) {
    return "0" + "00000" + String(plu).padStart(5, "0");
  }

  function render() {
    query = (search && search.value || "").trim();
    const filtered = window.PLUSearch
      ? window.PLUSearch.searchItems(items, query, activeCat)
      : items;
    countEl.textContent = String(filtered.length);
    empty.classList.toggle("hidden", filtered.length > 0);
    grid.innerHTML = filtered.map(cardHTML).join("");
    wireBarcodes(grid);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cardHTML(item, i) {
    return `
      <article class="card" style="animation-delay:${Math.min(i, 12) * 0.03}s" data-plu="${escapeHtml(item.plu)}">
        <div class="card-text">
          <h2 class="card-name">${escapeHtml(item.name)}</h2>
        </div>
        <p class="plu">${escapeHtml(item.plu)}</p>
        <div class="barcode-wrap">
          <svg class="barcode" data-code="${upcPayload(item.plu)}"></svg>
        </div>
      </article>
    `;
  }

  function wireBarcodes(root) {
    if (typeof JsBarcode === "undefined") return;
    root.querySelectorAll("svg.barcode").forEach((svg) => {
      try {
        JsBarcode(svg, svg.dataset.code, {
          format: "upc",
          width: 1.6,
          height: 48,
          displayValue: true,
          fontSize: 12,
          margin: 4,
          background: "#ffffff",
          lineColor: "#111111",
        });
      } catch (err) {
        svg.parentElement.innerHTML = `<code style="color:#333;font-size:0.75rem">${svg.dataset.code}</code>`;
      }
    });
  }

  catBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCat = btn.dataset.cat;
      catBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
      render();
    });
  });

  function onSearch() {
    render();
  }

  search.addEventListener("input", onSearch);
  search.addEventListener("search", onSearch);
  search.addEventListener("keyup", onSearch);

  async function refreshAuthLink() {
    if (!editLink) return;
    try {
      const res = await fetch("/api/me");
      const me = await res.json();
      editLink.href = me.authenticated ? "/edit" : "/login.html?next=/edit";
      editLink.textContent = me.authenticated ? "Edit" : "Login";
    } catch {
      editLink.href = "/login.html?next=/edit";
      editLink.textContent = "Login";
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/items");
      if (!res.ok) throw new Error("bad status");
      items = await res.json();
    } catch {
      items = [];
      empty.textContent = "Could not load items from the server.";
      empty.classList.remove("hidden");
    }
    render();
    refreshAuthLink();
  }

  load();
})();
