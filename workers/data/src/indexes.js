// The indexes of the store's tables (store.js), made when the object starts. The keys begin with the station or the site,
// so a query on the time alone (the last hours, what is older than the days kept) read every row in the table: on runs
// every minute that came to millions of rows a day, near the free plan's 5 million rows_read. With these, such a query
// reads only the rows it asks for. Tested in test/data-worker.test.js against the queries in store.js.
export const INDEXES = [
  "CREATE INDEX IF NOT EXISTS measurements_source_time ON measurements (source, time)",
  "CREATE INDEX IF NOT EXISTS forecast_hours_time ON forecast_hours (time)",
  "CREATE INDEX IF NOT EXISTS verify_hours_time ON verify_hours (time)",
];
