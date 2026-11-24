// Fotograf og lisens for bildene av flystedene.
//
// Ved import (`npm run images`) fjernes all metadata (GPS, kamera, redigeringshistorikk), og bare fotograf,
// opphavsrett, nettsted og lisens skrives tilbake. Fotografen leses fra originalen (EXIF Artist/Copyright eller
// XMP dc:creator/dc:rights, slik Lightroom skriver dem). Mangler den, brukes standarden i src/_data/photoCredit.json.
// Bildene på nettstedet (lib/images.js) får de samme feltene, og fotografen vises i bildeviseren.

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
      const value = plainText(tiff.toString("utf8", start, start + count).replace(/\0.*$/s, ""));
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

// Tekst fra metadata i bilder er ikke til å stole på. Den gjøres om til ren tekst: ingen tegn som kan danne
// HTML (< > " '), ingen kontrolltegn og maks 200 tegn. Malene escaper dessuten alt de skriver ut.
function plainText(value) {
  // eslint-disable-next-line no-control-regex -- det er nettopp kontrolltegn som fjernes
  return String(value).replace(/[<>"'\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

// Første rdf:li i et XMP-felt (dc:creator og dc:rights er lister), eller selve verdien.
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

// Fotografen fra metadataene i et bilde (sharp metadata(): exif og xmp er buffere). Tomt objekt hvis ingen.
export function readCredit(metadata) {
  const exif = readExifStrings(metadata?.exif);
  const xmp = metadata?.xmp ? metadata.xmp.toString("utf8") : "";
  // XMP først: det er UTF-8 (æøå, ©). EXIF tåler bare ASCII og brukes når XMP mangler.
  const credit = {
    creator: (xmp && readXmpField(xmp, "dc:creator")) || exif.creator || null,
    copyright: (xmp && readXmpField(xmp, "dc:rights")) || exif.copyright || null,
    url: (xmp && readXmpField(xmp, "Iptc4xmpCore:CiUrlWork")) || null,
  };
  // Nettstedet brukes som lenke, så bare vanlige http(s)-adresser godtas.
  if (credit.url && !/^https?:\/\/[^\s]+$/i.test(credit.url)) credit.url = null;
  return Object.fromEntries(Object.entries(credit).filter(([, v]) => v));
}

// Fotografen fra bildet, med standardverdier for det som mangler. Standardnettstedet brukes bare når fotografen
// er standardfotografen, så et bilde av noen andre ikke lenker til feil person.
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

// Opphavsrett med lisens, f.eks. «© Kristoffer D. Hofstad | Hofstad.NET | @krishofs · CC BY-NC 4.0».
function copyrightWithLicense(credit) {
  return credit.copyright.includes(credit.license) ? credit.copyright : `${credit.copyright} · ${credit.license}`;
}

// EXIF tåler bare ASCII: © blir (C), · blir -, og æøå translittereres. XMP har den nøyaktige teksten.
function ascii(s) {
  return String(s).replace(/©/g, "(C)").replace(/·/g, "-").replace(/æ/g, "ae").replace(/Æ/g, "Ae").replace(/ø/g, "o")
    .replace(/Ø/g, "O").replace(/å/g, "a").replace(/Å/g, "A").normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
}

// EXIF-felt for sharp withExif(): fotograf, og opphavsrett med lisens.
export function exifFor(credit) {
  return { IFD0: { Artist: ascii(credit.creator), Copyright: ascii(copyrightWithLicense(credit)) } };
}

// XMP for sharp withXmp(): fotograf, rettigheter, lenke til lisensen og nettsted, i feltene Lightroom og
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

// Har bildet fotograf og lisens i metadataene (satt ved import)?
export function hasCredit(metadata) {
  const own = readCredit(metadata);
  return !!own.creator && !!own.copyright;
}
