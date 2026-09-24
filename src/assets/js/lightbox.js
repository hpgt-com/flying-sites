// Bildevisning på stedssiden: trykk på et bilde for å se det stort, bla med piler, tastatur eller sveip.
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

  // Henter neste og forrige bilde i forkant, i samme størrelse som visningen vil velge.
  function preload(index) {
    var link = links[(index + links.length) % links.length];
    var img = new Image();
    img.sizes = sizesFor(link);
    img.srcset = link.getAttribute("data-srcset-webp");
  }

  function show(index) {
    current = (index + links.length) % links.length;
    var link = links[current];
    var thumb = link.querySelector("img");
    source.sizes = image.sizes = sizesFor(link);
    source.srcset = link.getAttribute("data-srcset-webp");
    image.srcset = link.getAttribute("data-srcset-jpeg");
    image.src = link.getAttribute("href");
    image.alt = thumb ? thumb.alt : "";
    text.textContent = link.getAttribute("data-caption") || "";
    counter.textContent = links.length > 1 ? "(" + (current + 1) + " av " + links.length + ")" : "";
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

  // Sveip til siden på mobil.
  var startX = null;
  dialog.addEventListener("pointerdown", function (ev) { startX = ev.clientX; });
  dialog.addEventListener("pointerup", function (ev) {
    if (startX === null || links.length < 2) return;
    var dx = ev.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });
})();
