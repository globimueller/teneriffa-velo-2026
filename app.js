/* ===== Tenerife 2026 – Interactive 3D route map (v4, external data) ===== */
(function () {
  "use strict";

  var DATA = [];
  var LANDMARKS = [];
  var ICON_URL_MAP = {};

  var NEON_COLORS = ["#00E5FF", "#FF2E97", "#B300FF", "#39FF14", "#2979FF", "#FFD300", "#FF0044", "#00FFA3", "#FF6600"];
  var CAT_META = {
    water:  { icon: "🚰", label: "Wasser" },
    bakery: { icon: "🥐", label: "Bäckerei" },
    lunch:  { icon: "🍽️", label: "Mittagessen" },
    sight:  { icon: "📸", label: "Sightseeing" }
  };
  var ISLAND_BOUNDS = [[-16.93, 27.95], [-16.10, 28.62]];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isMobileLayout() { return window.innerWidth <= 880; }
  function loadJSON(url) { return fetch(url).then(function (r) {
    if (!r.ok) throw new Error("Fetch failed: " + url + " (" + r.status + ")");
    return r.json();
  }); }

  var byKey = {};

  // ---------- GeoJSON builders ----------
  function routesGeoJSON() {
    var feats = [];
    DATA.forEach(function (r) {
      if (!r.coords) return;
      feats.push({ type: "Feature", properties: { key: r.key, color: r.color, name: r.name },
        geometry: { type: "LineString", coordinates: r.coords.map(function (c) { return [c[0], c[1]]; }) } });
    });
    return { type: "FeatureCollection", features: feats };
  }
  function poiIconId(p) {
    if (p.cat === "sight") return "poi-sight-" + (p.icon || "📸");
    return "poi-" + p.cat;
  }
  function poisGeoJSON() {
    var feats = [];
    DATA.forEach(function (r) {
      (r.pois || []).forEach(function (p) {
        feats.push({
          type: "Feature",
          properties: {
            routeKey: r.key, routeName: r.name, cat: p.cat, place: p.place,
            distKm: p.dist_km != null ? p.dist_km : null, ele: p.ele != null ? p.ele : null,
            iconId: poiIconId(p)
          },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] }
        });
      });
    });
    return { type: "FeatureCollection", features: feats };
  }
  function landmarksGeoJSON() {
    return {
      type: "FeatureCollection",
      features: LANDMARKS.map(function (l) {
        return { type: "Feature",
          properties: { key: l.key, name: l.name, subtitle: l.subtitle || "", iconId: "landmark-" + l.key },
          geometry: { type: "Point", coordinates: [l.lon, l.lat] } };
      })
    };
  }

  // ---------- Map init ----------
  var map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        "sat": { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri" },
        "terrain-dem": { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], tileSize: 256, encoding: "terrarium", maxzoom: 15 }
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0d1210" } },
        { id: "sat-layer", type: "raster", source: "sat", paint: { "raster-saturation": -0.15, "raster-contrast": 0.08, "raster-brightness-min": 0.05 } },
        { id: "hillshade", type: "hillshade", source: "terrain-dem", paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#0b0f0e", "hillshade-highlight-color": "#fff7e8", "hillshade-accent-color": "#1f6f78" } }
      ],
      sky: { "sky-color": "#0c2b30", "sky-horizon-blend": 0.5, "horizon-color": "#3a5c56", "horizon-fog-blend": 0.6, "fog-color": "#0d1917", "fog-ground-blend": 0.5 }
    },
    bounds: ISLAND_BOUNDS,
    fitBoundsOptions: { padding: { top: 90, bottom: 140, left: 60, right: 60 }, pitch: 55, bearing: -18 },
    maxPitch: 82,
    attributionControl: { compact: true }
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.scrollZoom.setWheelZoomRate(1 / 380);
  map.getCanvas().setAttribute("tabindex", "0");

  var selectedKey = null;
  var activeCats = { water: true, bakery: true, lunch: true, sight: true };
  var hoverMarker = null;
  var hoverPopup = null;

  function loadRoutes() {
    return loadJSON("routes/index.json").then(function (keys) {
      return Promise.all(keys.map(function (k) { return loadJSON("routes/" + k + ".json"); }));
    }).then(function (routes) {
      DATA = routes;
      DATA.forEach(function (r, i) { r.color = NEON_COLORS[i % NEON_COLORS.length]; });
      byKey = {}; DATA.forEach(function (r) { byKey[r.key] = r; });
    });
  }
  function loadLandmarks() { return loadJSON("landmarks.json").then(function (d) { LANDMARKS = d; }); }
  function loadIconUrlMap() { return loadJSON("icon_url_map.json").then(function (d) { ICON_URL_MAP = d; }); }

  function loadIconImages() {
    var ids = Object.keys(ICON_URL_MAP);
    return Promise.all(ids.map(function (id) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = "icons/map/" + ICON_URL_MAP[id] + ".png";
      });
    }));
  }

  map.on("load", function () {
    map.setTerrain({ source: "terrain-dem", exaggeration: 1.35 });

    Promise.all([loadRoutes(), loadLandmarks(), loadIconUrlMap()]).then(function () {
      map.addSource("routes", { type: "geojson", data: routesGeoJSON() });

      map.addLayer({ id: "routes-hit", type: "line", source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#000", "line-opacity": 0, "line-width": 22 } });
      map.addLayer({ id: "routes-glow", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 16, "line-blur": 6, "line-opacity": 0.0 } });
      map.addLayer({ id: "routes-line", type: "line", source: "routes", layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 12, 3.5, 16, 6], "line-opacity": 0.92 } });

      return loadIconImages().then(function () {
        map.addSource("pois", { type: "geojson", data: poisGeoJSON() });
        map.addSource("landmarks", { type: "geojson", data: landmarksGeoJSON() });

        map.addLayer({
          id: "poi-symbols", type: "symbol", source: "pois",
          layout: { "icon-image": ["get", "iconId"], "icon-size": 0.34, "icon-allow-overlap": true, "icon-anchor": "center", "icon-pitch-alignment": "map" },
          paint: { "icon-opacity": 1 }
        });
        map.addLayer({
          id: "landmark-symbols", type: "symbol", source: "landmarks",
          layout: { "icon-image": ["get", "iconId"], "icon-size": 0.30, "icon-allow-overlap": true, "icon-anchor": "bottom", "icon-pitch-alignment": "map" }
        });

        hoverPopup = new maplibregl.Popup({ offset: 14, closeButton: false, maxWidth: "230px" });

        function poiPopupHtml(p) {
          var distTxt = p.distKm != null ? (" · km " + p.distKm) : "";
          return '<div class="poi-pop"><strong>' + escapeHtml(p.place) + "</strong>" +
            '<div class="poi-pop-meta">' + escapeHtml(p.routeName) + distTxt + (p.ele != null ? (" · " + p.ele + " m ü.M.") : "") + "</div></div>";
        }
        function landmarkPopupHtml(p) {
          return '<div class="poi-pop"><strong>' + escapeHtml(p.name) + "</strong>" +
            (p.subtitle ? '<div class="poi-pop-meta">' + escapeHtml(p.subtitle) + "</div>" : "") + "</div>";
        }

        ["poi-symbols", "landmark-symbols"].forEach(function (layerId) {
          map.on("mouseenter", layerId, function (e) {
            map.getCanvas().style.cursor = "pointer";
            var f = e.features[0];
            var html = layerId === "poi-symbols" ? poiPopupHtml(f.properties) : landmarkPopupHtml(f.properties);
            hoverPopup.setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
          });
          map.on("mouseleave", layerId, function () { map.getCanvas().style.cursor = ""; hoverPopup.remove(); });
          map.on("click", layerId, function (e) {
            var f = e.features[0];
            var html = layerId === "poi-symbols" ? poiPopupHtml(f.properties) : landmarkPopupHtml(f.properties);
            hoverPopup.setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
          });
        });

        applyCategoryFilter();
      });
    }).then(function () {
      ["routes-line", "routes-hit"].forEach(function (layerId) {
        map.on("mouseenter", layerId, function () { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, function () { map.getCanvas().style.cursor = ""; });
        map.on("click", layerId, function (e) {
          var key = e.features[0].properties.key;
          selectRoute(key, { flyToRoute: true });
        });
      });

      buildRail();
      buildLegend();
      updateSelectionStyle();
      introSpin();

      hoverMarker = new maplibregl.Marker({ color: "#F2EDE4" }).setLngLat([0, 0]);
    }).catch(function (err) {
      console.error("Fehler beim Laden der Kartendaten:", err);
      var rail = document.getElementById("rail-list");
      if (rail) rail.innerHTML = '<p style="padding:16px;color:var(--lava);font-size:12px;">Fehler beim Laden der Routendaten: ' + escapeHtml(err.message) + '</p>';
    });
  });

  function introSpin() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var start = map.getBearing();
    map.easeTo({ bearing: start - 26, duration: 3200, easing: function (t) { return t; } });
  }

  // ---------- Category filter ----------
  function applyCategoryFilter() {
    if (!map.getLayer("poi-symbols")) return;
    var activeList = Object.keys(activeCats).filter(function (c) { return activeCats[c]; });
    map.setFilter("poi-symbols", ["in", ["get", "cat"], ["literal", activeList]]);
    map.setPaintProperty("poi-symbols", "icon-opacity",
      selectedKey ? ["case", ["==", ["get", "routeKey"], selectedKey], 1, 0.16] : 1);
  }

  function buildLegend() {
    var wrap = document.getElementById("cat-filters");
    wrap.innerHTML = "";
    Object.keys(CAT_META).forEach(function (cat) {
      var meta = CAT_META[cat];
      var btn = document.createElement("button");
      btn.className = "cat-btn is-active";
      btn.dataset.cat = cat;
      btn.innerHTML = '<span>' + meta.icon + '</span>' + meta.label;
      btn.addEventListener("click", function () {
        activeCats[cat] = !activeCats[cat];
        btn.classList.toggle("is-active", activeCats[cat]);
        applyCategoryFilter();
      });
      wrap.appendChild(btn);
    });
  }

  // ---------- Rail ----------
  function railCard(r, index) {
    var missing = !r.coords;
    var div = document.createElement("button");
    div.className = "route-card" + (missing ? " is-missing" : "");
    div.style.setProperty("--rc", r.color);
    div.dataset.key = r.key;
    div.innerHTML =
      '<span class="rc-num">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="rc-body">' +
      '<span class="rc-name">' + escapeHtml(r.name) + (missing ? ' <em>GPX folgt</em>' : '') + '</span>' +
      '<span class="rc-stats"><span class="rc-stat"><b>' + r.distance.toFixed(1) + '</b> km</span>' +
      '<span class="rc-stat"><b>' + r.gain.toLocaleString("de-CH") + '</b> Hm</span></span>' +
      '<span class="rc-intensity" aria-hidden="true">' + r.intensity + '</span>' +
      '</span>';
    div.addEventListener("click", function () { selectRoute(r.key, { flyToRoute: true }); });
    return div;
  }
  function buildRail() {
    var rail = document.getElementById("rail-list");
    rail.innerHTML = "";
    DATA.forEach(function (r, i) { rail.appendChild(railCard(r, i)); });
  }

  function updateSelectionStyle() {
    document.querySelectorAll(".route-card").forEach(function (el) {
      var sel = el.dataset.key === selectedKey;
      el.classList.toggle("is-selected", sel);
      if (sel) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    applyCategoryFilter();
    if (map.getLayer("routes-line")) {
      map.setPaintProperty("routes-line", "line-width", selectedKey
        ? ["case", ["==", ["get", "key"], selectedKey], ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 6, 16, 9],
            ["interpolate", ["linear"], ["zoom"], 8, 1.4, 12, 2, 16, 3]]
        : ["interpolate", ["linear"], ["zoom"], 8, 2, 12, 3.5, 16, 6]);
      map.setPaintProperty("routes-line", "line-opacity", selectedKey ? ["case", ["==", ["get", "key"], selectedKey], 1, 0.28] : 0.92);
    }
    if (map.getLayer("routes-glow")) {
      map.setPaintProperty("routes-glow", "line-opacity", selectedKey ? 0.6 : 0.0);
      map.setPaintProperty("routes-glow", "line-width", ["case", ["==", ["get", "key"], selectedKey || "__none__"], 16, 0]);
    }
  }

  // ---------- Layout state: keep rail + drawer from ever overlapping ----------
  function setRailCollapsed(collapsed) {
    var rail = document.getElementById("rail");
    rail.classList.toggle("collapsed", collapsed);
    syncHeaderForRailState();
  }
  function syncHeaderForRailState() {
    var collapsed = document.getElementById("rail").classList.contains("collapsed");
    document.getElementById("topbar").classList.toggle("list-open", !collapsed && isMobileLayout());
    document.body.classList.toggle("rail-collapsed", collapsed);
  }

  // ---------- Selection & drawer ----------
  function selectRoute(key, opts) {
    var r = byKey[key];
    if (!r) return;
    selectedKey = key;
    updateSelectionStyle();
    openDrawer(r);
    if (isMobileLayout()) setRailCollapsed(true);
    if ((opts && opts.flyToRoute) && r.bbox) {
      var mobile = isMobileLayout();
      var mobileBottomPad = Math.round(window.innerHeight * 0.42);
      map.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], {
        padding: mobile ? { top: 80, bottom: mobileBottomPad, left: 24, right: 24 } : { top: 110, bottom: 320, left: 400, right: 90 },
        pitch: 58, bearing: bearingForRoute(r), duration: 1400
      });
    }
  }
  function bearingForRoute(r) {
    if (!r.coords || r.coords.length < 2) return -18;
    var a = r.coords[0], b = r.coords[r.coords.length - 1];
    var y = Math.sin((b[0] - a[0]) * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180);
    var x = Math.cos(a[1] * Math.PI / 180) * Math.sin(b[1] * Math.PI / 180) -
      Math.sin(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.cos((b[0] - a[0]) * Math.PI / 180);
    return Math.atan2(y, x) * 180 / Math.PI;
  }

  function setDrawerOpen(isOpen) {
    document.getElementById("drawer").classList.toggle("open", isOpen);
    document.body.classList.toggle("drawer-open", isOpen);
  }

  function openDrawer(r) {
    setDrawerOpen(true);
    document.getElementById("d-name").textContent = r.name;
    document.getElementById("d-intensity").textContent = r.intensity;
    document.getElementById("d-dist").textContent = r.distance.toFixed(1);
    document.getElementById("d-gain").textContent = r.gain.toLocaleString("de-CH");
    document.getElementById("d-resupply").textContent = r.resupply;

    var stravaLink = document.getElementById("d-strava");
    stravaLink.href = r.strava;

    var gpxBtn = document.getElementById("d-gpx");
    gpxBtn.disabled = !r.coords;
    gpxBtn.onclick = function () { if (r.coords) downloadGpx(r); };

    var missNote = document.getElementById("d-missing");
    if (!r.coords) { missNote.style.display = "block"; missNote.textContent = "GPX noch nicht verfügbar – Karte folgt, sobald die Route gespeichert ist."; }
    else { missNote.style.display = "none"; }

    renderFacts(r);
    renderSights(r);
    renderPoiChips(r);
    renderProfile(r);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("drawer-close").addEventListener("click", function () {
      setDrawerOpen(false);
      selectedKey = null; updateSelectionStyle();
    });
  });

  function flyToPoi(lon, lat, label, routeName) {
    map.flyTo({ center: [lon, lat], zoom: 15.6, pitch: 64, duration: 1300 });
    if (hoverPopup) {
      var html = '<div class="poi-pop"><strong>' + escapeHtml(label) + "</strong>" +
        (routeName ? '<div class="poi-pop-meta">' + escapeHtml(routeName) + "</div>" : "") + "</div>";
      window.setTimeout(function () { hoverPopup.setLngLat([lon, lat]).setHTML(html).addTo(map); }, 1250);
    }
  }

  function renderFacts(r) {
    var wrap = document.getElementById("d-facts");
    wrap.innerHTML = "";
    (r.facts || []).forEach(function (f) {
      var li = document.createElement("li"); li.textContent = f; wrap.appendChild(li);
    });
  }
  function renderSights(r) {
    var wrap = document.getElementById("d-sights");
    wrap.innerHTML = "";
    var sights = (r.pois || []).filter(function (p) { return p.cat === "sight"; });
    sights.forEach(function (s) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "stop-chip cat-sight";
      chip.title = "Auf der Karte anzeigen";
      chip.textContent = (s.icon || "📸") + " " + s.place;
      chip.addEventListener("click", function () { flyToPoi(s.lon, s.lat, s.place, r.name); });
      wrap.appendChild(chip);
    });
    document.getElementById("d-sights-empty").style.display = sights.length ? "none" : "block";
  }
  function renderPoiChips(r) {
    var wrap = document.getElementById("d-stops");
    wrap.innerHTML = "";
    var chips = (r.pois || []).filter(function (p) { return p.cat !== "sight"; });
    chips.forEach(function (s) {
      var meta = CAT_META[s.cat];
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "stop-chip cat-" + s.cat;
      chip.title = "Auf der Karte anzeigen";
      var distTxt = (s.dist_km != null) ? (" · km " + s.dist_km) : "";
      chip.textContent = meta.icon + " " + s.place + distTxt;
      chip.addEventListener("click", function () { flyToPoi(s.lon, s.lat, s.place, r.name); });
      wrap.appendChild(chip);
    });
    document.getElementById("d-poi-empty").style.display = chips.length ? "none" : "block";
  }

  // ---------- GPX download ----------
  function downloadGpx(r) {
    var pts = r.coords.map(function (c) {
      return '<trkpt lat="' + c[1] + '" lon="' + c[0] + '"><ele>' + c[2] + '</ele></trkpt>';
    }).join("\n   ");
    var gpx = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx creator="Tenerife2026Map" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      ' <metadata><name>' + escapeHtml(r.name) + '</name></metadata>\n' +
      ' <trk><name>' + escapeHtml(r.name) + '</name><type>cycling</type><trkseg>\n   ' + pts + '\n </trkseg></trk>\n</gpx>';
    var blob = new Blob([gpx], { type: "application/gpx+xml" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "Tenerife2026_" + r.key + ".gpx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Elevation profile with hover-sync ----------
  function renderProfile(r) {
    var svgNS = "http://www.w3.org/2000/svg";
    var container = document.getElementById("d-profile");
    container.innerHTML = "";
    if (!r.profile || !r.profile.length) { container.classList.add("empty"); return; }
    container.classList.remove("empty");
    var W = container.clientWidth || 560, H = 120;
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("profile-svg");

    var xs = r.profile.map(function (p) { return p[0]; });
    var ys = r.profile.map(function (p) { return p[1]; });
    var maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var padY = 10, padB = 4;
    function X(x) { return (x / maxX) * W; }
    function Y(y) { return H - padB - ((y - minY) / Math.max(1, (maxY - minY))) * (H - padY - padB); }

    var d = "M 0 " + H + " ";
    r.profile.forEach(function (p) { d += "L " + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1) + " "; });
    d += "L " + W + " " + H + " Z";

    var gradId = "grad-" + r.key;
    var defs = document.createElementNS(svgNS, "defs");
    var grad = document.createElementNS(svgNS, "linearGradient");
    grad.setAttribute("id", gradId); grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
    var s1 = document.createElementNS(svgNS, "stop"); s1.setAttribute("offset", "0%"); s1.setAttribute("stop-color", r.color); s1.setAttribute("stop-opacity", "0.55");
    var s2 = document.createElementNS(svgNS, "stop"); s2.setAttribute("offset", "100%"); s2.setAttribute("stop-color", r.color); s2.setAttribute("stop-opacity", "0.03");
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);

    var path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "url(#" + gradId + ")");
    path.setAttribute("stroke", r.color); path.setAttribute("stroke-width", "1.6");
    svg.appendChild(path);

    (r.pois || []).filter(function (p) { return p.cat !== "sight" && p.dist_km != null; }).forEach(function (s) {
      var cx = X(s.dist_km), cy = Y(s.ele != null ? s.ele : minY);
      var c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", cx.toFixed(1)); c.setAttribute("cy", cy.toFixed(1)); c.setAttribute("r", "4");
      c.setAttribute("class", "profile-stop cat-" + s.cat);
      var title = document.createElementNS(svgNS, "title"); title.textContent = s.place + " · km " + s.dist_km;
      c.appendChild(title);
      svg.appendChild(c);
    });

    var hoverLine = document.createElementNS(svgNS, "line");
    hoverLine.setAttribute("class", "hover-line"); hoverLine.setAttribute("y1", "0"); hoverLine.setAttribute("y2", H);
    hoverLine.style.display = "none";
    svg.appendChild(hoverLine);
    var hoverDot = document.createElementNS(svgNS, "circle");
    hoverDot.setAttribute("class", "hover-dot"); hoverDot.setAttribute("r", "4.5");
    hoverDot.style.display = "none";
    svg.appendChild(hoverDot);

    var coordDist = [0];
    for (var i = 1; i < r.coords.length; i++) {
      var a = r.coords[i - 1], b = r.coords[i];
      var dx = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
      var dy = (b[1] - a[1]) * 110540;
      coordDist.push(coordDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var totalCoordDist = coordDist[coordDist.length - 1];

    function coordAtKm(km) {
      var target = (km / maxX) * totalCoordDist;
      var lo = 0, hi = coordDist.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (coordDist[mid] < target) lo = mid + 1; else hi = mid; }
      var idx = Math.max(1, lo);
      var d0 = coordDist[idx - 1], d1 = coordDist[idx];
      var t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
      var p0 = r.coords[idx - 1], p1 = r.coords[idx];
      return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    }

    function onMove(clientX) {
      var rect = svg.getBoundingClientRect();
      var x = Math.max(0, Math.min(W, clientX - rect.left));
      var km = (x / W) * maxX;
      var yVal = interpY(km);
      hoverLine.setAttribute("x1", x.toFixed(1)); hoverLine.setAttribute("x2", x.toFixed(1));
      hoverLine.style.display = "";
      hoverDot.setAttribute("cx", x.toFixed(1)); hoverDot.setAttribute("cy", Y(yVal).toFixed(1)); hoverDot.style.display = "";
      var lngLat = coordAtKm(km);
      if (hoverMarker) { hoverMarker.setLngLat(lngLat).addTo(map); }
      document.getElementById("d-profile-hover").textContent = km.toFixed(1) + " km · " + Math.round(yVal) + " m ü.M.";
    }
    function interpY(km) {
      for (var i = 1; i < r.profile.length; i++) {
        if (r.profile[i][0] >= km) {
          var p0 = r.profile[i - 1], p1 = r.profile[i];
          var t = p1[0] > p0[0] ? (km - p0[0]) / (p1[0] - p0[0]) : 0;
          return p0[1] + (p1[1] - p0[1]) * t;
        }
      }
      return r.profile[r.profile.length - 1][1];
    }
    svg.addEventListener("mousemove", function (e) { onMove(e.clientX); });
    svg.addEventListener("mouseleave", function () {
      hoverLine.style.display = "none"; hoverDot.style.display = "none";
      document.getElementById("d-profile-hover").textContent = "";
      if (hoverMarker) hoverMarker.remove();
    });
    svg.addEventListener("touchmove", function (e) { if (e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });

    container.appendChild(svg);
    var labels = document.getElementById("d-profile-labels");
    labels.innerHTML = "<span>0 km</span><span>" + maxX.toFixed(0) + " km</span>";
  }

  // ---------- Topbar height tracking ----------
  function observeTopbarHeight() {
    var topbar = document.getElementById("topbar");
    function apply() {
      document.documentElement.style.setProperty("--topbar-h", topbar.getBoundingClientRect().height + "px");
    }
    apply();
    if (window.ResizeObserver) { new ResizeObserver(apply).observe(topbar); }
    window.addEventListener("resize", apply);
  }

  // ---------- Legend / rail / help toggles ----------
  document.addEventListener("DOMContentLoaded", function () {
    observeTopbarHeight();
    syncHeaderForRailState();

    document.getElementById("legend-toggle").addEventListener("click", function () {
      document.getElementById("legend-panel").classList.toggle("open");
    });
    document.getElementById("rail-toggle").addEventListener("click", function () {
      var rail = document.getElementById("rail");
      var willOpen = rail.classList.contains("collapsed");
      setRailCollapsed(!willOpen);
      if (willOpen && isMobileLayout()) {
        setDrawerOpen(false);
      }
    });
    document.getElementById("help-toggle").addEventListener("click", toggleHelp);
    document.getElementById("help-close").addEventListener("click", toggleHelp);
  });

  function toggleHelp() { document.getElementById("help-panel").classList.toggle("open"); }

  // ---------- Google-Earth-style keyboard navigation ----------
  var PAN_PX = 90;
  window.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    var handled = true;
    switch (e.key) {
      case "ArrowUp": case "w": case "W": map.panBy([0, -PAN_PX], { duration: 200 }); break;
      case "ArrowDown": case "s": case "S": map.panBy([0, PAN_PX], { duration: 200 }); break;
      case "ArrowLeft": case "a": case "A": map.panBy([-PAN_PX, 0], { duration: 200 }); break;
      case "ArrowRight": case "d": case "D": map.panBy([PAN_PX, 0], { duration: 200 }); break;
      case "q": case "Q": map.easeTo({ bearing: map.getBearing() - 12, duration: 200 }); break;
      case "e": case "E": map.easeTo({ bearing: map.getBearing() + 12, duration: 200 }); break;
      case "r": case "R": map.easeTo({ pitch: Math.min(82, map.getPitch() + 8), duration: 200 }); break;
      case "f": case "F": map.easeTo({ pitch: Math.max(0, map.getPitch() - 8), duration: 200 }); break;
      case "+": case "=": map.easeTo({ zoom: map.getZoom() + 0.6, duration: 200 }); break;
      case "-": case "_": map.easeTo({ zoom: map.getZoom() - 0.6, duration: 200 }); break;
      case "0": map.easeTo({ bearing: 0, pitch: 55, duration: 500 }); break;
      case "Escape":
        setDrawerOpen(false);
        document.getElementById("help-panel").classList.remove("open");
        selectedKey = null; updateSelectionStyle();
        break;
      case "?": toggleHelp(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  window.addEventListener("resize", function () {
    if (selectedKey) renderProfile(byKey[selectedKey]);
    syncHeaderForRailState();
  });
})();
