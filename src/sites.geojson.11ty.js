// Open data: all sites as GeoJSON at /flysteder.geojson, generated on every build (lib/export.js).
import { sitesToGeoJSON } from "../lib/export.js";

export default class {
  data() {
    return { permalink: "/flysteder.geojson", eleventyExcludeFromCollections: true };
  }

  render({ collections, site }) {
    return JSON.stringify(sitesToGeoJSON(collections.sites, site.url), null, 1);
  }
}
