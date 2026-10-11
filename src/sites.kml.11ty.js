// Open data: all sites as KML at /flysteder.kml (Google Earth, norgeskart.no, map apps).
import { sitesToGeoJSON, geoJSONToKML } from "../lib/export.js";

export default class {
  data() {
    return { permalink: "/flysteder.kml", eleventyExcludeFromCollections: true };
  }

  render({ collections, site }) {
    return geoJSONToKML(sitesToGeoJSON(collections.sites, site.url));
  }
}
