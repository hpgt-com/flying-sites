// Indeksene til tabellene i lageret (store.js), laget når objektet starter. Nøkkelen i verify_hours begynner med
// stedet, så en spørring på bare tiden (de siste dagene, det som er eldre enn et år) ville lest hver rad i tabellen.
// Med indeksen leser den bare radene den spør etter. De andre tabellene trenger ingen: nøklene deres begynner med tiden
// (eller kilden og tiden). Hver indeks koster én skrevet rad per rad som skrives til tabellen. Derfor har bare
// verify_hours, med noen hundre rader i døgnet, en indeks. Testet i test/store-indexes.test.js mot spørringene i
// store.js, og mengden i test/data-quota.test.js.
export const INDEXES = [
  "CREATE INDEX IF NOT EXISTS verify_hours_time ON verify_hours (time)",
];
