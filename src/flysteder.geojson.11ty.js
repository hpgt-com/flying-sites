// Åpne data: alle flystedene som GeoJSON på /flysteder.geojson, laget ved hver bygging (lib/export.js).
import { sitesToGeoJSON } from "../lib/export.js";

export default class {
  data() {
    return { permalink: "/flysteder.geojson", eleventyExcludeFromCollections: true };
  }

  render({ collections, site }) {
    return JSON.stringify(sitesToGeoJSON(collections.sites, site.url), null, 1);
  }
}
