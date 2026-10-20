// The indexes of the store's tables (store.js), made when the object starts. The keys of these two begin with the site,
// so a query on the time alone (the last hours, what is older than the days kept) read every row in the table: on runs
// every minute that came to millions of rows a day, near the free plan's 5 million rows_read. With these, such a query
// reads only the rows it asks for. The measurements need none: their key begins with the source and the time. Each
// index also costs a row written per row written to its table. Tested in test/store-indexes.test.js against the queries
// in store.js, and the volume in test/data-quota.test.js.
export const INDEXES = [
  "CREATE INDEX IF NOT EXISTS forecast_hours_time ON forecast_hours (time)",
  "CREATE INDEX IF NOT EXISTS verify_hours_time ON verify_hours (time)",
];
