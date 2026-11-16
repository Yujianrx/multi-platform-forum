export default async function teardown() {
  try {
    await fetch('http://127.0.0.1:3100/__test_shutdown', { method: 'POST' });
  } catch {
    /* Already stopped after an interrupted test. */
  }
}
