'use strict';
// Roster: which accounts belong to which party. An account can be in at most one party.
const store = require('./store');

function load() {
  const raw = store.readRaw('roster');
  const out = {};
  for (const [partyId, e] of Object.entries(raw || {})) {
    out[partyId] = { accountIds: [...new Set((e.accountIds || []).filter((x) => typeof x === 'string' && x))] };
  }
  return out;
}

const save = (r) => store.writeRaw('roster', r);

function getAll() {
  return Object.entries(load()).map(([partyId, e]) => ({ partyId, ...e }));
}

function memberIds(partyId) {
  return load()[partyId]?.accountIds ?? [];
}

function assign(partyId, accountId) {
  if (!partyId || !accountId) return false;
  const r = load();
  for (const [id, e] of Object.entries(r)) if (id !== partyId) e.accountIds = e.accountIds.filter((a) => a !== accountId);
  const e = (r[partyId] ??= { accountIds: [] });
  if (!e.accountIds.includes(accountId)) e.accountIds.push(accountId);
  save(r);
  return true;
}

/** Replaces the member list (and order) of a party; the accounts leave any other party. */
function setOrder(partyId, ids) {
  if (!partyId || !Array.isArray(ids)) return false;
  const clean = [...new Set(ids.filter((x) => typeof x === 'string' && x))];
  const r = load();
  for (const [id, e] of Object.entries(r)) if (id !== partyId) e.accountIds = e.accountIds.filter((a) => !clean.includes(a));
  (r[partyId] ??= { accountIds: [] }).accountIds = clean;
  save(r);
  return true;
}

function remove(partyId, accountId) {
  const r = load();
  const e = r[partyId];
  if (!e || !e.accountIds.includes(accountId)) return false;
  e.accountIds = e.accountIds.filter((a) => a !== accountId);
  save(r);
  return true;
}

/** Drops parties and members that no longer exist in storage. Returns true when something changed. */
function prune(partyIds, accountIds) {
  const r = load();
  let changed = false;
  for (const [id, e] of Object.entries(r)) {
    if (!partyIds.has(id)) { delete r[id]; changed = true; continue; }
    const kept = e.accountIds.filter((a) => accountIds.has(a));
    if (kept.length !== e.accountIds.length) { e.accountIds = kept; changed = true; }
  }
  if (changed) save(r);
  return changed;
}

module.exports = { getAll, memberIds, assign, setOrder, remove, prune };
