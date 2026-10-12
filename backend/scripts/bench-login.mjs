// Mide el bloqueo del servidor durante un pico de logins simultáneos. Ver docs/escalabilidad.md §4.
// Requiere un usuario "benchuser" / "Bench1234*" y AUTH_RATE_LIMIT alto en el servidor probado. SOLO entornos de prueba.
// Mide el bloqueo del event loop durante N logins simultáneos: mientras se hacen,
// se consulta /health repetidamente; si el servidor está ocupado con bcrypt, /health tarda.
const B = process.env.BASE ?? "http://127.0.0.1:4400";
const N = Number(process.env.N ?? 20);
const login = () => fetch(`${B}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "benchuser", password: "Bench1234*" }) });
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
let running = true; const health = [];
const probe = (async () => { while (running) { const t = performance.now(); await fetch(`${B}/health`); health.push(performance.now() - t); await new Promise(r => setTimeout(r, 5)); } })();
const t0 = performance.now();
const res = await Promise.all(Array.from({ length: N }, async () => { const t = performance.now(); const r = await login(); await r.text(); return [r.status, performance.now() - t]; }));
const total = performance.now() - t0; running = false; await probe;
const lat = res.map(r => r[1]);
console.log(`logins=${N} status=${[...new Set(res.map(r => r[0]))]} total=${total.toFixed(0)}ms login p50=${pct(lat,.5).toFixed(0)} p95=${pct(lat,.95).toFixed(0)} | /health durante el pico: p50=${pct(health,.5).toFixed(0)}ms p95=${pct(health,.95).toFixed(0)}ms max=${Math.max(...health).toFixed(0)}ms (${health.length} muestras)`);
