// Image viewer on the site page: tap an image to see it large, browse with arrows, keyboard or swipe.
// Zoom: pinch with two fingers, double-tap or mouse wheel. Drag to pan when the image is zoomed.
// The links (a[data-lightbox]) point to the large image, so without JavaScript the image opens as normal.
(function () {
  "use strict";

  var FS = window.FlyingSites;

  // Order in the viewer (data-lightbox-index): all overview images, then launch, then landing. Images not
  // shown on the page are hidden links after the grid.
  var links = Array.prototype.slice.call(document.querySelectorAll("a[data-lightbox]"));
  links.sort(function (a, b) {
    return Number(a.getAttribute("data-lightbox-index")) - Number(b.getAttribute("data-lightbox-index"));
  });
  if (!links.length || typeof HTMLDialogElement !== "function") return;

  var dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Bildevisning");
  dialog.innerHTML =
    '<figure class="lightbox__figure">' +
    '<picture><source type="image/webp" sizes="100vw"><img class="lightbox__image" sizes="100vw" alt=""></picture>' +
    '<figcaption class="lightbox__caption"><span class="lightbox__text"></span> <span class="lightbox__counter"></span><span class="lightbox__credit"></span></figcaption>' +
    "</figure>" +
    '<button type="button" class="lightbox__button lightbox__close" aria-label="' + FS.escapeHtml(FS.t("lightbox.close")) + '">×</button>' +
    '<button type="button" class="lightbox__button lightbox__prev" aria-label="' + FS.escapeHtml(FS.t("lightbox.prev")) + '">‹</button>' +
    '<button type="button" class="lightbox__button lightbox__next" aria-label="' + FS.escapeHtml(FS.t("lightbox.next")) + '">›</button>';
  document.body.appendChild(dialog);

  var source = dialog.querySelector("source");
  var image = dialog.querySelector("img");
  var text = dialog.querySelector(".lightbox__text");
  var counter = dialog.querySelector(".lightbox__counter");
  var credit = dialog.querySelector(".lightbox__credit");

  // «Foto: Navn · CC BY-NC 4.0», linking to the photographer's website and the licence. Built with DOM methods.
  function creditLink(textValue, href) {
    if (!href) return document.createTextNode(textValue);
    var a = document.createElement("a");
    a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = textValue;
    return a;
  }
  function showCredit(l) {
    var name = l.getAttribute("data-credit");
    if (!name) { credit.replaceChildren(); return; }
    credit.replaceChildren(document.createTextNode(FS.t("lightbox.photo") + ": "), creditLink(name, l.getAttribute("data-credit-url")),
      document.createTextNode(" · "), creditLink(l.getAttribute("data-license") || "", l.getAttribute("data-license-url")));
  }
  var current = 0;
  var opener = null;

  if (links.length < 2) {
    dialog.querySelector(".lightbox__prev").hidden = true;
    dialog.querySelector(".lightbox__next").hidden = true;
  }

  // The image is never shown larger than the largest available version (data-width), so small images
  // such as the overview drawings are not blown up. On smaller screens it fills the width.
  function sizesFor(link) {
    var width = Number(link.getAttribute("data-width"));
    return width ? "(max-width: " + width + "px) 100vw, " + width + "px" : "100vw";
  }

  // The browser picks the size from the screen and pixel density, so new phones with higher resolution
  // get sharper images automatically. Exception: if the user has data saver on, or the network is slow
  // (2G/3G), at most 1600 px is fetched. The browser reports this where it can (navigator.connection).
  var SAVE_DATA_MAX_WIDTH = 1600;
  var connection = navigator.connection || {};
  var limitData = !!connection.saveData || /(^|-)(2g|3g)$/.test(connection.effectiveType || "");
  function srcsetFor(link, attribute) {
    var set = link.getAttribute(attribute) || "";
    if (!limitData) return set;
    var kept = set.split(/,\s*/).filter(function (candidate) {
      return !(parseInt(candidate.split(" ").pop(), 10) > SAVE_DATA_MAX_WIDTH);
    });
    return kept.length ? kept.join(", ") : set;
  }

  // Preloads the next and previous image, at the size the viewer will pick.
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
    image.alt = thumb ? thumb.alt : link.getAttribute("data-alt") || "";
    text.textContent = link.getAttribute("data-caption") || "";
    counter.textContent = links.length > 1 ? FS.t("lightbox.of", { i: current + 1, n: links.length }) : "";
    showCredit(link);
    resetZoom();
    if (!dialog.open) {
      dialog.showModal();
      // Focus on the close button, not the photographer's link, which is replaced when browsing.
      dialog.querySelector(".lightbox__close").focus();
    }
    fit();
    if (links.length > 1) {
      preload(current + 1);
      preload(current - 1);
    }
  }

  // The image gets a fixed pixel size that fits the screen now: as large as possible, but never larger
  // than the image's own width (small images are not stretched). Recomputed when the phone is rotated or the
  // window resizes. Without this the image keeps the size it had when opened.
  function fit() {
    var link = links[current];
    var w = Number(link.getAttribute("data-width")) || image.naturalWidth;
    var h = Number(link.getAttribute("data-height")) || image.naturalHeight;
    if (!w || !h) { image.style.width = image.style.height = ""; return; }
    var s = Math.min(dialog.clientWidth / w, dialog.clientHeight / h, 1);
    image.style.width = Math.floor(w * s) + "px";
    image.style.height = Math.floor(h * s) + "px";
  }
  image.addEventListener("load", function () { if (dialog.open) fit(); });
  window.addEventListener("resize", function () {
    if (!dialog.open) return;
    resetZoom();
    // The browser picks the image size again for the new screen width.
    source.sizes = image.sizes = sizesFor(links[current]);
    fit();
  });

  links.forEach(function (link, index) {
    link.addEventListener("click", function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return; // let "open in new tab" work as normal
      ev.preventDefault();
      opener = link;
      FS.track("images" + location.pathname);
      show(index);
    });
  });

  // «Se alle N bilder» opens the viewer on the first image.
  Array.prototype.forEach.call(document.querySelectorAll("[data-lightbox-all]"), function (button) {
    button.hidden = false;
    button.addEventListener("click", function () {
      opener = button;
      FS.track("images" + location.pathname);
      show(0);
    });
  });

  dialog.querySelector(".lightbox__close").addEventListener("click", function () { dialog.close(); });
  dialog.querySelector(".lightbox__prev").addEventListener("click", function () { show(current - 1); });
  dialog.querySelector(".lightbox__next").addEventListener("click", function () { show(current + 1); });

  // Back to the image that was opened, so keyboard users keep their place.
  dialog.addEventListener("close", function () { if (opener) opener.focus(); });

  // Clicking the dark area around the image closes the viewer.
  dialog.addEventListener("click", function (ev) {
    if (ev.target === dialog || ev.target.classList.contains("lightbox__figure")) dialog.close();
  });

  // On the document, not the dialog: arrow keys should work even if focus has left the viewer.
  document.addEventListener("keydown", function (ev) {
    if (!dialog.open) return;
    if (ev.key === "ArrowLeft") show(current - 1);
    else if (ev.key === "ArrowRight") show(current + 1);
  });

  // --- Zoom and panning ---
  // The browser's own pinch zoom works poorly in a full-screen viewer, so the image is zoomed here.
  // The image is never shown larger than the largest available version, so zoom helps most on small screens.
  var MAX_SCALE = 5;
  var zoom = { scale: 1, x: 0, y: 0 };
  var pointers = {}; // pointerId: { x, y }
  var gesture = null; // ongoing pinch or pan
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
  // Zooms to `scale` keeping the point (cx, cy) in screen coordinates fixed. `from` is the zoom to
  // compute from (default: the current one). The image is scaled around its centre (transform-origin).
  function zoomAt(scale, cx, cy, from) {
    from = from || zoom;
    scale = Math.min(MAX_SCALE, Math.max(1, scale));
    var rect = image.getBoundingClientRect();
    // Centre of the image without panning, in screen coordinates. rect is the image as currently shown (zoomed).
    var ox = rect.left + rect.width / 2 - zoom.x, oy = rect.top + rect.height / 2 - zoom.y;
    var k = scale / from.scale;
    zoom = { scale: scale, x: (cx - ox) - (cx - ox - from.x) * k, y: (cy - oy) - (cy - oy - from.y) * k };
    if (scale === 1) { zoom.x = 0; zoom.y = 0; }
    clampPan();
    applyZoom();
  }
  // Keeps the image within the screen, so it cannot be dragged away entirely.
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
      // From the zoom when the pinch started, moved with the fingers' midpoint.
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
    // From pinch to one finger: continue as a pan, so the image does not jump.
    if (p.length === 1 && zoom.scale > 1) gesture = { type: "pan", start: p[0], x: zoom.x, y: zoom.y };
    else if (!p.length) gesture = null;
  }
  image.addEventListener("pointerup", endPointer);
  image.addEventListener("pointercancel", endPointer);

  // Double-tap and double-click zoom in where pressed, or back out. A tap is short and without
  // movement, so the end of a pan or pinch is not counted. The browser also sends dblclick
  // after a double-tap on mobile, so it is ignored right after a double-tap has been handled.
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

  // Swipe sideways on mobile, only when the image is not zoomed and with one finger.
  dialog.addEventListener("pointerdown", function (ev) { swipeStart = zoom.scale === 1 && points().length <= 1 ? ev.clientX : null; });
  dialog.addEventListener("pointerup", function (ev) {
    if (swipeStart === null || links.length < 2 || zoom.scale > 1) return;
    var dx = ev.clientX - swipeStart;
    swipeStart = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });
})();
