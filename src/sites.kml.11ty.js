// Åpne data: alle flystedene som KML på /flysteder.kml (Google Earth, norgeskart.no, kartapper).
import { sitesToGeoJSON, geoJSONToKML } from "../lib/export.js";

export default class {
  data() {
    return { permalink: "/flysteder.kml", eleventyExcludeFromCollections: true };
  }

  render({ collections, site }) {
    return geoJSONToKML(sitesToGeoJSON(collections.sites, site.url));
  }
}
