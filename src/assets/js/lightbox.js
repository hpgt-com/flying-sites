// Bildevisning på stedssiden: trykk på et bilde for å se det stort, bla med piler, tastatur eller sveip.
// Zoom: knip med to fingre, dobbelttrykk eller musehjul. Dra for å flytte når bildet er zoomet.
// Lenkene (a[data-lightbox]) peker til det store bildet, så uten JavaScript åpnes bildet som vanlig.
(function () {
  "use strict";

  var links = Array.prototype.slice.call(document.querySelectorAll("a[data-lightbox]"));
  if (!links.length || typeof HTMLDialogElement !== "function") return;

  var dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Bildevisning");
  dialog.innerHTML =
    '<figure class="lightbox__figure">' +
    '<picture><source type="image/webp" sizes="100vw"><img class="lightbox__image" sizes="100vw" alt=""></picture>' +
    '<figcaption class="lightbox__caption"><span class="lightbox__text"></span> <span class="lightbox__counter"></span></figcaption>' +
    "</figure>" +
    '<button type="button" class="lightbox__button lightbox__close" aria-label="Lukk bildevisningen">×</button>' +
    '<button type="button" class="lightbox__button lightbox__prev" aria-label="Forrige bilde">‹</button>' +
    '<button type="button" class="lightbox__button lightbox__next" aria-label="Neste bilde">›</button>';
  document.body.appendChild(dialog);

  var source = dialog.querySelector("source");
  var image = dialog.querySelector("img");
  var text = dialog.querySelector(".lightbox__text");
  var counter = dialog.querySelector(".lightbox__counter");
  var current = 0;
  var opener = null;

  if (links.length < 2) {
    dialog.querySelector(".lightbox__prev").hidden = true;
    dialog.querySelector(".lightbox__next").hidden = true;
  }

  // Bildet vises aldri større enn den største versjonen som finnes (data-width), så små bilder
  // som oversiktstegningene ikke blåses opp. På mindre skjermer fyller det bredden.
  function sizesFor(link) {
    var width = Number(link.getAttribute("data-width"));
    return width ? "(max-width: " + width + "px) 100vw, " + width + "px" : "100vw";
  }

  // Mobiler henter aldri mer enn 1600 px, heller ikke på tvers der skjermen har mange piksler, for å spare
  // mobildata. Store skjermer og retina på PC får 2400 px, så bildet blir skarpt over hele skjermen.
  var PHONE_MAX_WIDTH = 1600;
  var isPhone = Math.min(screen.width, screen.height) < 768;
  function srcsetFor(link, attribute) {
    var set = link.getAttribute(attribute) || "";
    if (!isPhone) return set;
    var kept = set.split(/,\s*/).filter(function (candidate) {
      return !(parseInt(candidate.split(" ").pop(), 10) > PHONE_MAX_WIDTH);
    });
    return kept.length ? kept.join(", ") : set;
  }

  // Henter neste og forrige bilde i forkant, i samme størrelse som visningen vil velge.
  function preload(index) {
    var link = links[(index + links.length) % links.length];
    var img = new Image();
    img.sizes = sizesFor(link);
    img.srcset = srcsetFor(link, "data-srcset-webp");
  }

  function show(index) {
    current = (index + links.length) % links.length;
    var link = links[current];
    var thumb = link.querySelector("img");
    source.sizes = image.sizes = sizesFor(link);
    source.srcset = srcsetFor(link, "data-srcset-webp");
    image.srcset = srcsetFor(link, "data-srcset-jpeg");
    image.src = link.getAttribute("href");
    image.alt = thumb ? thumb.alt : "";
    text.textContent = link.getAttribute("data-caption") || "";
    counter.textContent = links.length > 1 ? "(" + (current + 1) + " av " + links.length + ")" : "";
    resetZoom();
    if (!dialog.open) dialog.showModal();
    if (links.length > 1) {
      preload(current + 1);
      preload(current - 1);
    }
  }

  links.forEach(function (link, index) {
    link.addEventListener("click", function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return; // la «åpne i ny fane» virke som vanlig
      ev.preventDefault();
      opener = link;
      show(index);
    });
  });

  dialog.querySelector(".lightbox__close").addEventListener("click", function () { dialog.close(); });
  dialog.querySelector(".lightbox__prev").addEventListener("click", function () { show(current - 1); });
  dialog.querySelector(".lightbox__next").addEventListener("click", function () { show(current + 1); });

  // Tilbake til bildet som ble åpnet, så tastaturbrukere ikke mister plassen sin.
  dialog.addEventListener("close", function () { if (opener) opener.focus(); });

  // Klikk i det mørke feltet rundt bildet lukker visningen.
  dialog.addEventListener("click", function (ev) {
    if (ev.target === dialog || ev.target.classList.contains("lightbox__figure")) dialog.close();
  });

  dialog.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowLeft") show(current - 1);
    else if (ev.key === "ArrowRight") show(current + 1);
  });

  // --- Zoom og flytting ---
  // Nettleserens egen knipe-zoom virker dårlig i en visning som fyller skjermen, så bildet zoomes her.
  // Bildet vises aldri større enn den største versjonen som finnes, så zoom gir mest på små skjermer.
  var MAX_SCALE = 5;
  var zoom = { scale: 1, x: 0, y: 0 };
  var pointers = {}; // pointerId: { x, y }
  var gesture = null; // pågående knip eller flytting
  var swipeStart = null;

  function applyZoom() {
    image.style.transform = zoom.scale > 1 ? "translate(" + zoom.x + "px, " + zoom.y + "px) scale(" + zoom.scale + ")" : "";
    dialog.classList.toggle("lightbox--zoomed", zoom.scale > 1);
  }
  function resetZoom() {
    zoom = { scale: 1, x: 0, y: 0 };
    pointers = {};
    gesture = null;
    applyZoom();
  }
  // Zoomer til `scale` med punktet (cx, cy) i skjermkoordinater liggende i ro. `from` er zoomen det
  // regnes fra (standard: den som vises nå). Bildet skaleres rundt midten (transform-origin).
  function zoomAt(scale, cx, cy, from) {
    from = from || zoom;
    scale = Math.min(MAX_SCALE, Math.max(1, scale));
    var rect = image.getBoundingClientRect();
    // Midten av bildet uten flytting, i skjermkoordinater. rect viser bildet slik det vises nå (zoom).
    var ox = rect.left + rect.width / 2 - zoom.x, oy = rect.top + rect.height / 2 - zoom.y;
    var k = scale / from.scale;
    zoom = { scale: scale, x: (cx - ox) - (cx - ox - from.x) * k, y: (cy - oy) - (cy - oy - from.y) * k };
    if (scale === 1) { zoom.x = 0; zoom.y = 0; }
    clampPan();
    applyZoom();
  }
  // Holder bildet innenfor skjermen, så det ikke kan dras helt bort.
  function clampPan() {
    var w = image.offsetWidth * zoom.scale, h = image.offsetHeight * zoom.scale;
    var maxX = Math.max(0, (w - window.innerWidth) / 2 + 40), maxY = Math.max(0, (h - window.innerHeight) / 2 + 40);
    zoom.x = Math.min(maxX, Math.max(-maxX, zoom.x));
    zoom.y = Math.min(maxY, Math.max(-maxY, zoom.y));
  }
  function points() { return Object.keys(pointers).map(function (id) { return pointers[id]; }); }

  image.addEventListener("pointerdown", function (ev) {
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    image.setPointerCapture(ev.pointerId);
    var p = points();
    if (p.length === 2) {
      gesture = { type: "pinch", distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), scale: zoom.scale,
        mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, x: zoom.x, y: zoom.y };
      swipeStart = null;
    } else if (p.length === 1 && zoom.scale > 1) {
      gesture = { type: "pan", start: p[0], x: zoom.x, y: zoom.y };
    }
  });
  image.addEventListener("pointermove", function (ev) {
    if (!pointers[ev.pointerId]) return;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var p = points();
    if (gesture && gesture.type === "pinch" && p.length === 2) {
      // Fra zoomen da knipet startet, flyttet med fingrenes midtpunkt.
      var mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      var from = { scale: gesture.scale, x: gesture.x + (mid.x - gesture.mid.x), y: gesture.y + (mid.y - gesture.mid.y) };
      zoomAt(gesture.scale * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / gesture.distance, mid.x, mid.y, from);
    } else if (gesture && gesture.type === "pan") {
      zoom.x = gesture.x + (p[0].x - gesture.start.x);
      zoom.y = gesture.y + (p[0].y - gesture.start.y);
      clampPan();
      applyZoom();
    }
  });
  function endPointer(ev) {
    delete pointers[ev.pointerId];
    var p = points();
    // Fra knip til én finger: fortsett som flytting, så bildet ikke hopper.
    if (p.length === 1 && zoom.scale > 1) gesture = { type: "pan", start: p[0], x: zoom.x, y: zoom.y };
    else if (!p.length) gesture = null;
  }
  image.addEventListener("pointerup", endPointer);
  image.addEventListener("pointercancel", endPointer);

  // Dobbelttrykk og dobbeltklikk zoomer inn der man trykker, eller ut igjen. Et trykk er kort og uten
  // bevegelse, så slutten på en flytting eller et knip ikke telles. Nettleseren sender også dblclick
  // etter dobbelttrykk på mobil, så den ignoreres rett etter at et dobbelttrykk er håndtert.
  var tap = { start: null, last: 0, handled: 0 };
  image.addEventListener("pointerdown", function (ev) {
    tap.start = ev.pointerType === "touch" && points().length === 1 ? { x: ev.clientX, y: ev.clientY, t: Date.now() } : null;
  });
  image.addEventListener("pointerup", function (ev) {
    var st = tap.start;
    tap.start = null;
    if (!st || points().length || Date.now() - st.t > 300 || Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 10) return;
    var now = Date.now();
    if (now - tap.last < 350) {
      zoomAt(zoom.scale > 1 ? 1 : 2.5, ev.clientX, ev.clientY);
      tap.last = 0;
      tap.handled = now;
    } else tap.last = now;
  });
  image.addEventListener("dblclick", function (ev) {
    ev.preventDefault();
    if (Date.now() - tap.handled < 600) return;
    zoomAt(zoom.scale > 1 ? 1 : 2.5, ev.clientX, ev.clientY);
  });
  dialog.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    zoomAt(zoom.scale * (ev.deltaY < 0 ? 1.2 : 1 / 1.2), ev.clientX, ev.clientY);
  }, { passive: false });
  dialog.addEventListener("close", resetZoom);

  // Sveip til siden på mobil, bare når bildet ikke er zoomet og med én finger.
  dialog.addEventListener("pointerdown", function (ev) { swipeStart = zoom.scale === 1 && points().length <= 1 ? ev.clientX : null; });
  dialog.addEventListener("pointerup", function (ev) {
    if (swipeStart === null || links.length < 2 || zoom.scale > 1) return;
    var dx = ev.clientX - swipeStart;
    swipeStart = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });
})();
