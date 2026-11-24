// En liten stand-in for nettleserens document, for tester av nettleserskript som bygger elementer med DOM-metoder
// (createElement, createElementNS, setAttribute, append …). html() skriver det som ble bygget, som markup å sjekke mot.
class Node {
  constructor() { this.childNodes = []; }
  appendChild(child) {
    if (child instanceof Fragment) { child.childNodes.forEach((c) => this.childNodes.push(c)); child.childNodes = []; }
    else this.childNodes.push(child);
    return child;
  }
  append(...children) { children.forEach((c) => this.appendChild(typeof c === "string" ? new Text(c) : c)); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(value) { this.childNodes = [new Text(String(value))]; }
}
class Text {
  constructor(data) { this.data = data; }
  get textContent() { return this.data; }
}
class Fragment extends Node {}
class Element extends Node {
  constructor(tag, namespaceURI) { super(); this.tagName = tag; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = {}; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
}

export function installDom() {
  globalThis.document = {
    createElement: (tag) => new Element(tag, "http://www.w3.org/1999/xhtml"),
    createElementNS: (ns, tag) => new Element(tag, ns),
    createTextNode: (data) => new Text(String(data)),
    createDocumentFragment: () => new Fragment(),
    // En tom side: skriptene ser etter elementene sine når de lastes, og finner ingen.
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Noden (eller nodene i et fragment) som markup, med attributtene i den rekkefølgen de ble satt; "" for null.
export function html(node) {
  if (node == null) return "";
  if (node instanceof Text) return escapeText(node.data);
  const inner = node.childNodes.map(html).join("");
  if (node instanceof Fragment) return inner;
  const attrs = [...node.attributes].map(([k, v]) => ` ${k}="${escapeText(v).replace(/"/g, "&quot;")}"`).join("");
  return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
}
