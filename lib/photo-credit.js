// Photographer and license for the site images.
//
// On import (`npm run images`) all metadata is stripped (GPS, camera, edit history), and only photographer,
// copyright, website and license are written back. The photographer is read from the original (EXIF Artist/Copyright
// or XMP dc:creator/dc:rights, as written by Lightroom). If missing, the default in src/_data/photoCredit.json is used.
// The images on the site (lib/images.js) get the same fields, and the photographer is shown in the image viewer.

import fs from "node:fs";

export const DEFAULT_CREDIT = JSON.parse(fs.readFileSync(new URL("../src/_data/photoCredit.json", import.meta.url), "utf8"));

// ASCII fields in the first EXIF directory (IFD0): 0x013B Artist, 0x8298 Copyright.
function readExifStrings(exif) {
  const out = {};
  if (!exif || exif.length < 14) return out;
  const tiff = exif.subarray(exif.indexOf("Exif\0\0") === 0 ? 6 : 0);
  const little = tiff.toString("ascii", 0, 2) === "II";
  const u16 = (o) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd0 = u32(4);
    const entries = u16(ifd0);
    for (let i = 0; i < entries; i++) {
      const e = ifd0 + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type !== 2 || (tag !== 0x013b && tag !== 0x8298)) continue;
      const start = count > 4 ? u32(e + 8) : e + 8;
      const value = plainText(tiff.toString("utf8", start, start + count).replace(/\0.*$/s, ""));
      if (value) out[tag === 0x013b ? "creator" : "copyright"] = value;
    }
  } catch {
    // corrupt EXIF: use what we have
  }
  return out;
}

function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Text from image metadata is untrusted. It is reduced to plain text: no characters that could form
// HTML (< > " '), no control characters, and at most 200 characters. The templates also escape all output.
function plainText(value) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped
  return String(value).replace(/[<>"'\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

// First rdf:li in an XMP field (dc:creator and dc:rights are lists), or the value itself.
function readXmpField(xmp, name) {
  const block = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xmp);
  if (block) {
    const li = /<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(block[1]);
    const value = plainText(xmlUnescape(li ? li[1] : block[1].includes("<") ? "" : block[1]));
    if (value) return value;
  }
  const attr = new RegExp(`${name}="([^"]*)"`).exec(xmp);
  const value = attr ? plainText(xmlUnescape(attr[1])) : "";
  return value || null;
}

// Photographer from an image's metadata (sharp metadata(): exif and xmp are buffers). Empty object if none.
export function readCredit(metadata) {
  const exif = readExifStrings(metadata?.exif);
  const xmp = metadata?.xmp ? metadata.xmp.toString("utf8") : "";
  // XMP first: it is UTF-8 (æøå, ©). EXIF only handles ASCII and is used when XMP is missing.
  const credit = {
    creator: (xmp && readXmpField(xmp, "dc:creator")) || exif.creator || null,
    copyright: (xmp && readXmpField(xmp, "dc:rights")) || exif.copyright || null,
    url: (xmp && readXmpField(xmp, "Iptc4xmpCore:CiUrlWork")) || null,
  };
  // The website is used as a link, so only plain http(s) URLs are accepted.
  if (credit.url && !/^https?:\/\/[^\s]+$/i.test(credit.url)) credit.url = null;
  return Object.fromEntries(Object.entries(credit).filter(([, v]) => v));
}

// The photographer from the image, with defaults for anything missing. The default website is only used when
// the photographer is the default one, so a photo by someone else does not link to the wrong person.
export function creditFor(metadata, defaults = DEFAULT_CREDIT) {
  const own = readCredit(metadata);
  const creator = own.creator || defaults.creator;
  const sameAsDefault = creator === defaults.creator;
  return {
    creator,
    copyright: own.copyright || (sameAsDefault ? defaults.copyright : `© ${creator}`),
    url: own.url || (sameAsDefault ? defaults.url : null),
    urlLabel: own.url ? null : sameAsDefault ? defaults.urlLabel : null,
    license: defaults.license,
    licenseUrl: defaults.licenseUrl,
  };
}

// Copyright with license, e.g. «© Kristoffer D. Hofstad | Hofstad.NET | @krishofs · CC BY-NC 4.0».
function copyrightWithLicense(credit) {
  return credit.copyright.includes(credit.license) ? credit.copyright : `${credit.copyright} · ${credit.license}`;
}

// EXIF only handles ASCII: © becomes (C), · becomes -, and æøå are transliterated. XMP has the exact text.
function ascii(s) {
  return String(s).replace(/©/g, "(C)").replace(/·/g, "-").replace(/æ/g, "ae").replace(/Æ/g, "Ae").replace(/ø/g, "o")
    .replace(/Ø/g, "O").replace(/å/g, "a").replace(/Å/g, "A").normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
}

// EXIF fields for sharp withExif(): photographer, and copyright with license.
export function exifFor(credit) {
  return { IFD0: { Artist: ascii(credit.creator), Copyright: ascii(copyrightWithLicense(credit)) } };
}

// XMP for sharp withXmp(): photographer, rights, license link and website, in the fields Lightroom and
// Creative Commons use.
export function xmpFor(credit) {
  const e = xmlEscape;
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:cc="http://creativecommons.org/ns#"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmpRights:Marked="True"
    xmpRights:WebStatement="${e(credit.licenseUrl)}">
   <dc:creator><rdf:Seq><rdf:li>${e(credit.creator)}</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${e(copyrightWithLicense(credit))}</rdf:li></rdf:Alt></dc:rights>
   <cc:license rdf:resource="${e(credit.licenseUrl)}"/>${credit.url ? `
   <Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource"><Iptc4xmpCore:CiUrlWork>${e(credit.url)}</Iptc4xmpCore:CiUrlWork></Iptc4xmpCore:CreatorContactInfo>` : ""}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// Does the image have photographer and license in its metadata (set on import)?
export function hasCredit(metadata) {
  const own = readCredit(metadata);
  return !!own.creator && !!own.copyright;
}
