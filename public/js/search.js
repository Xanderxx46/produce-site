(() => {
  const ALIASES = {
    apple: ["apples"],
    apples: ["apple"],
    avocado: ["avocados", "hass"],
    avocados: ["avocado", "hass"],
    banana: ["bananas"],
    bananas: ["banana"],
    bell: ["pepper", "peppers"],
    chile: ["chili", "pepper", "peppers"],
    chili: ["chile", "pepper", "peppers"],
    grape: ["grapefruit"],
    hass: ["avocado", "avocados"],
    honeycrisp: ["apple", "apples"],
    jalapeno: ["pepper", "peppers", "chile"],
    melon: ["melons", "cantaloupe", "watermelon", "watermelons"],
    onion: ["onions"],
    onions: ["onion"],
    pepper: ["peppers", "chile", "chili"],
    peppers: ["pepper", "chile", "chili"],
    potato: ["potatoes"],
    potatoes: ["potato"],
    roma: ["tomato", "tomatoes", "plum"],
    russet: ["potato", "potatoes"],
    scallion: ["scallions", "onion", "onions", "green"],
    scallions: ["scallion", "onion", "onions", "green"],
    slicer: ["tomato", "tomatoes"],
    squash: ["zucchini", "calabacita"],
    tomato: ["tomatoes"],
    tomatoes: ["tomato"],
    watermelon: ["watermelons", "melon"],
    watermelons: ["watermelon", "melon"],
    yam: ["yams", "sweet"],
    yams: ["yam", "sweet"],
    zucchini: ["squash"],
  };

  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(/\s+/).filter(Boolean);
  }

  function expand(word) {
    return [word, ...(ALIASES[word] || [])];
  }

  function wordMatch(candidate, queryToken) {
    if (!candidate || !queryToken) return false;
    if (candidate === queryToken) return true;
    if (candidate.startsWith(queryToken)) return true;
    if (queryToken.startsWith(candidate) && candidate.length >= 3) return true;
    return expand(candidate).some((alias) => alias === queryToken || alias.startsWith(queryToken));
  }

  function scoreItem(item, rawQuery) {
    const qTokens = tokens(rawQuery);
    if (!qTokens.length) return 1;

    const nameTokens = tokens(item.name);
    const plu = String(item.plu || "");
    const qJoined = qTokens.join(" ");
    const nameJoined = nameTokens.join(" ");

    if (qTokens.length === 1 && /^\d+$/.test(qTokens[0])) {
      const n = qTokens[0];
      if (plu === n) return 1000;
      if (plu.startsWith(n)) return 850;
      if (plu.includes(n)) return 500;
    }

    const sameWords =
      qTokens.length === nameTokens.length &&
      [...qTokens].sort().join(" ") === [...nameTokens].sort().join(" ");
    if (sameWords) return 950;

    if (nameJoined === qJoined) return 940;
    if (nameJoined.startsWith(qJoined)) return 800;

    const pool = [...nameTokens, item.cat, plu].filter(Boolean);
    const leftover = [...pool];
    for (const qt of qTokens) {
      const idx = leftover.findIndex((nt) => wordMatch(nt, qt) || nt.includes(qt));
      if (idx === -1) return 0;
      leftover.splice(idx, 1);
    }

    let score = 500;
    score += qTokens.filter((qt) => nameTokens.some((nt) => nt === qt)).length * 40;
    score += qTokens.filter((qt) => nameTokens.some((nt) => nt.startsWith(qt))).length * 15;
    score -= Math.min(nameJoined.length, 60);
    return score;
  }

  function searchItems(items, rawQuery, cat) {
    const scored = [];
    for (const item of items) {
      if (cat && cat !== "all" && item.cat !== cat) continue;
      const score = scoreItem(item, rawQuery);
      if (score > 0) scored.push({ item, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.name.localeCompare(b.item.name);
    });
    return scored.map((row) => row.item);
  }

  window.PLUSearch = { searchItems, normalize };
})();
