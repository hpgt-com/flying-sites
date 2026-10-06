// Fotograf og lisens for bildene på flystedene.
//
// Ved import (`npm run images`) fjernes all metadata (GPS, kamera, redigeringshistorikk), og bare fotograf,
// copyright, nettside og lisens skrives tilbake. Fotografen leses fra originalen (EXIF Artist/Copyright eller
// XMP dc:creator/dc:rights, som Lightroom skriver). Mangler den, brukes standarden i src/_data/photoCredit.json.
// Bildene på siden (lib/images.js) får de samme feltene, og fotografen vises i bildevisningen.

import fs from "node:fs";

export const DEFAULT_CREDIT = JSON.parse(fs.readFileSync(new URL("../src/_data/photoCredit.json", import.meta.url), "utf8"));

// ASCII-felt i første EXIF-katalog (IFD0): 0x013B Artist, 0x8298 Copyright.
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
      const value = tiff.toString("utf8", start, start + count).replace(/\0.*$/s, "").trim();
      if (value) out[tag === 0x013b ? "creator" : "copyright"] = value;
    }
  } catch {
    // ødelagt EXIF: bruk det vi har
  }
  return out;
}

function xmlUnescape(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Første rdf:li i et XMP-felt (dc:creator og dc:rights er lister), eller verdien direkte.
function readXmpField(xmp, name) {
  const block = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xmp);
  if (block) {
    const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(block[1]);
    const value = (li ? li[1] : block[1]).replace(/<[^>]+>/g, "").trim();
    if (value) return xmlUnescape(value);
  }
  const attr = new RegExp(`${name}="([^"]*)"`).exec(xmp);
  return attr && attr[1] ? xmlUnescape(attr[1]) : null;
}

// Fotograf fra metadataen til et bilde (sharp metadata(): exif og xmp er buffere). Tomt objekt hvis ingenting.
export function readCredit(metadata) {
  const exif = readExifStrings(metadata?.exif);
  const xmp = metadata?.xmp ? metadata.xmp.toString("utf8") : "";
  // XMP først: den er UTF-8 (æøå, ©). EXIF tåler bare ASCII og brukes når XMP mangler.
  const credit = {
    creator: (xmp && readXmpField(xmp, "dc:creator")) || exif.creator || null,
    copyright: (xmp && readXmpField(xmp, "dc:rights")) || exif.copyright || null,
    url: (xmp && readXmpField(xmp, "Iptc4xmpCore:CiUrlWork")) || null,
  };
  return Object.fromEntries(Object.entries(credit).filter(([, v]) => v));
}

// Fotografen fra bildet, og standarden for det som mangler. Nettsiden følger standarden bare når fotografen
// er den samme, så et bilde fra en annen fotograf ikke lenker til feil person.
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

// Copyright med lisens, for eksempel «© Kristoffer D. Hofstad | Hofstad.NET | @krishofs · CC BY-NC 4.0».
function copyrightWithLicense(credit) {
  return credit.copyright.includes(credit.license) ? credit.copyright : `${credit.copyright} · ${credit.license}`;
}

// EXIF tåler bare ASCII: © blir (C), · blir -, og æøå skrives uten aksent. XMP har den riktige teksten.
function ascii(s) {
  return String(s).replace(/©/g, "(C)").replace(/·/g, "-").replace(/æ/g, "ae").replace(/Æ/g, "Ae").replace(/ø/g, "o")
    .replace(/Ø/g, "O").replace(/å/g, "a").replace(/Å/g, "A").normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
}

// EXIF-felt til sharp withExif(): fotograf og copyright med lisens.
export function exifFor(credit) {
  return { IFD0: { Artist: ascii(credit.creator), Copyright: ascii(copyrightWithLicense(credit)) } };
}

// XMP til sharp withXmp(): fotograf, rettigheter, lisenslenke og nettside, i feltene Lightroom og
// Creative Commons bruker.
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

// Har bildet fotograf og lisens i metadata (satt av import)?
export function hasCredit(metadata) {
  const own = readCredit(metadata);
  return !!own.creator && !!own.copyright;
}
