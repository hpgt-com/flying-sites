// The indexes of the store's tables (store.js), made when the object starts. The key of verify_hours begins with the
// site, so a query on the time alone (the last days, what is older than a year) would read every row in the table; with
// the index it reads only the rows it asks for. The other tables need none: their keys begin with the time (or the
// source and the time). Each index costs a row written per row written to its table, so verify_hours, written a few
// hundred rows a day, is the only one with one. Tested in test/store-indexes.test.js against the queries
// in store.js, and the volume in test/data-quota.test.js.
export const INDEXES = [
  "CREATE INDEX IF NOT EXISTS verify_hours_time ON verify_hours (time)",
];
