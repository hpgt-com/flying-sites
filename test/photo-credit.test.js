import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { creditFor, exifFor, hasCredit, readCredit, xmpFor, DEFAULT_CREDIT } from "../lib/photo-credit.js";

const blank = () => sharp({ create: { width: 20, height: 20, channels: 3, background: "#888" } });

test("without a photographer in the image the default is used, with licence", () => {
  const c = creditFor({});
  assert.equal(c.creator, DEFAULT_CREDIT.creator);
  assert.equal(c.url, DEFAULT_CREDIT.url);
  assert.equal(c.license, "CC BY-NC 4.0");
});

test("photographer and licence survive EXIF and XMP, with © and æøå in XMP", async () => {
  const c = { ...creditFor({}), creator: "Bjørn Ås", copyright: "© Bjørn Ås", url: null };
  const buf = await blank().jpeg().withExif(exifFor(c)).withXmp(xmpFor(c)).toBuffer();
  const meta = await sharp(buf).metadata();
  assert.deepEqual(readCredit(meta), { creator: "Bjørn Ås", copyright: "© Bjørn Ås · CC BY-NC 4.0" });
  assert.equal(hasCredit(meta), true);
  assert.equal(exifFor(c).IFD0.Artist, "Bjorn As"); // EXIF only handles ASCII
});

test("another photographer (from Lightroom) is kept, without the default website", async () => {
  const buf = await blank().jpeg().withExif({ IFD0: { Artist: "Ola Nordmann", Copyright: "(C) Ola Nordmann" } }).toBuffer();
  const c = creditFor(await sharp(buf).metadata());
  assert.equal(c.creator, "Ola Nordmann");
  assert.equal(c.url, null);
  assert.equal(c.license, "CC BY-NC 4.0");
});

test("an image without metadata has no photographer", async () => {
  assert.equal(hasCredit(await sharp(await blank().jpeg().toBuffer()).metadata()), false);
});

test("text from metadata becomes plain text, and the website must be http(s)", async () => {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">
<dc:creator><rdf:Seq><rdf:li>Ola &lt;script&gt;alert(1)&lt;/script&gt; "Nordmann"</rdf:li></rdf:Seq></dc:creator>
<Iptc4xmpCore:CiUrlWork>javascript:alert(1)</Iptc4xmpCore:CiUrlWork></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const buf = await blank().jpeg().withXmp(xmp).toBuffer();
  const c = readCredit(await sharp(buf).metadata());
  assert.equal(c.creator, "Ola scriptalert(1)/script Nordmann");
  assert.equal(c.url, undefined);
});
