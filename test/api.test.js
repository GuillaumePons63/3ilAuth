import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { SignJWT, jwtVerify } from "jose";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/passwords.js";

const secret = "secret-de-test-aleatoire-distinct-1234567890";
const password = "Une-phrase-de-test-longue-et-unique!";

test("Argon2id : sel différent, vérification et refus du mauvais mot de passe", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^\$argon2id\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(first, password), true);
  assert.equal(await verifyPassword(second, password), true);
  assert.equal(await verifyPassword(first, "Autre-phrase-incorrecte!"), false);
});

test("API, persistance et autorisations entre deux comptes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "3il-prisma-"));
  const path = join(folder, "test.db");
  const url = `file:${path.replaceAll("\\", "/")}`;
  const sqlite = new DatabaseSync(path);
  const migration = readFileSync(new URL("../prisma/migrations/202610060001_init/migration.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  sqlite.close();
  let prisma = createDatabase(url);
  let server;
  try {
    const app = await createApp(prisma, secret);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, { method = "GET", body, token } = {}) {
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    const post = (body, token) => ({ method: "POST", body, token });
    assert.equal((await request("/me")).status, 401);
    assert.equal((await request("/auth/register", post({ email: "incorrect", password }))).status, 400);
    assert.equal((await request("/auth/register", post({ email: "alice@example.test", password: "court" }))).status, 400);
    const alice = await request("/auth/register", post({ email: " ALICE@example.test ", password }));
    assert.equal(alice.status, 201);
    assert.deepEqual(Object.keys(alice.body).sort(), ["email", "id"]);
    assert.equal((await request("/auth/register", post({ email: "alice@example.test", password }))).status, 409);
    const bob = await request("/auth/register", post({ email: "bob@example.test", password }));
    assert.equal(bob.status, 201);
    const wrongPassword = await request("/auth/login", post({ email: "alice@example.test", password: "Une-autre-phrase-incorrecte" }));
    const absentUser = await request("/auth/login", post({ email: "absent@example.test", password }));
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword, absentUser);
    const aliceLogin = await request("/auth/login", post({ email: "alice@example.test", password }));
    const bobLogin = await request("/auth/login", post({ email: "bob@example.test", password }));
    assert.equal(aliceLogin.status, 200);
    assert.equal(bobLogin.status, 200);
    const aliceToken = aliceLogin.body.access_token;
    const bobToken = bobLogin.body.access_token;
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(aliceToken, key);
    assert.equal(payload.exp - payload.iat, 900);
    assert.deepEqual((await request("/me", { token: aliceToken })).body, alice.body);
    assert.equal((await request("/tickets", post({ title: "a" }, aliceToken))).status, 400);
    const ticket = await request("/tickets", post({ title: "Demande Alice", userId: bob.body.id }, aliceToken));
    assert.equal(ticket.status, 201);
    assert.deepEqual((await request("/tickets", { token: aliceToken })).body, [ticket.body]);
    assert.deepEqual((await request("/tickets", { token: bobToken })).body, []);
    const altered = `${aliceToken.slice(0, -10)}0123456789`;
    assert.equal((await request("/me", { token: altered })).status, 401);
    const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
      .setSubject(String(alice.body.id)).setIssuer("3il-cours").setAudience("3il-api")
      .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
    assert.equal((await request("/me", { token: expired })).status, 401);
    const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
      .setSubject(String(alice.body.id)).setIssuer("3il-cours").setAudience("autre-api")
      .setIssuedAt().setExpirationTime("15m").sign(key);
    assert.equal((await request("/me", { token: wrongAudience })).status, 401);
    const missingClaims = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
      .setSubject(String(alice.body.id)).setIssuer("3il-cours").setAudience("3il-api").sign(key);
    assert.equal((await request("/me", { token: missingClaims })).status, 401);
    const malformed = await fetch(base + "/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(malformed.status, 400);
    assert.equal((await request("/auth/login", post({ email: "alice@example.test", password }))).status, 200);
    const limited = await request("/auth/login", post({ email: "alice@example.test", password }));
    assert.equal(limited.status, 429);
    await new Promise(resolve => server.close(resolve));
    server = null;
    await prisma.$disconnect();
    prisma = createDatabase(url);
    assert.equal(await prisma.user.count(), 2);
    assert.equal((await prisma.ticket.findFirst()).title, "Demande Alice");
    assert.equal((await prisma.ticket.findFirst()).userId, alice.body.id);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
    rmSync(folder, { recursive: true, force: true });
  }
});
