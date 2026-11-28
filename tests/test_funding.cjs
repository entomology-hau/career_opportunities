'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../site/funding.js'), 'utf8');

function page(entries, initialTime, savedTheme = null) {
  let now = Date.parse(initialTime);
  let tick;
  const handlers = {};
  const button = {attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(name, fn) { handlers[name] = fn; }};
  const label = {textContent: ''};
  const colour = {content: ''};
  const storage = new Map([['entomology-theme', savedTheme]]);
  const rounds = entries.map(({dataset, text}) => {
    const status = {textContent: text};
    return {dataset, status, hidden: false, querySelector() { return status; }};
  });
  const document = {
    documentElement: {dataset: {}}, hidden: false,
    getElementById(id) { return id === 'theme-toggle' ? button : label; },
    querySelector() { return colour; },
    querySelectorAll() { return rounds; },
    addEventListener(name, fn) { handlers[name] = fn; }
  };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(script, {
    Date: Clock, Intl, document,
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    setInterval(fn, interval) { assert.equal(interval, 60000); tick = fn; }
  });
  return {
    rounds, button, label, colour, document, storage, handlers,
    advance(time) { now = Date.parse(time); tick(); }
  };
}

test('exact application window opens and closes at the stated time while retaining the listing', () => {
  const p = page([{
    dataset: {opensAt: '2027-01-11T10:00:00+00:00', closesAt: '2027-01-12T10:00:00+00:00'},
    text: 'Opens 11 January 2027'
  }], '2027-01-11T09:59:59Z');
  assert.equal(p.rounds[0].status.textContent, 'Opens 11 January 2027');
  p.advance('2027-01-11T10:00:00Z');
  assert.equal(p.rounds[0].status.textContent, 'Application window open');
  p.advance('2027-01-12T09:59:59Z');
  assert.equal(p.rounds[0].status.textContent, 'Application window open');
  p.advance('2027-01-12T10:00:00Z');
  assert.equal(p.rounds[0].status.textContent, 'Listed round closed · check next round');
  assert.equal(p.rounds[0].hidden, false);
});

test('date-only deadline expires at the end of its London calendar day, including British Summer Time', () => {
  const p = page([{dataset: {closesOn: '2027-09-30'}, text: '2027 round announced'}], '2027-09-30T22:59:59Z');
  assert.equal(p.rounds[0].status.textContent, '2027 round announced');
  p.advance('2027-09-30T23:00:00Z');
  assert.equal(p.rounds[0].status.textContent, 'Listed round closed · check next round');
});

test('unknown, invalid and future dates retain the editorial status', () => {
  const p = page([
    {dataset: {}, text: 'Next round to be confirmed'},
    {dataset: {closesOn: '2027-02-31'}, text: 'Check provider'},
    {dataset: {closesAt: 'not-a-date'}, text: 'Check date'},
    {dataset: {opensAt: '2027-01-11T10:00:00Z', closesAt: '2027-01-12T10:00:00Z'}, text: 'Opens in January'}
  ], '2026-11-24T12:00:00Z');
  assert.deepEqual(p.rounds.map(round => round.status.textContent), [
    'Next round to be confirmed', 'Check provider', 'Check date', 'Opens in January'
  ]);
});

test('shared theme preference sets the label and toggles persistently', () => {
  const p = page([], '2026-11-24T12:00:00Z', 'dark');
  assert.equal(p.document.documentElement.dataset.theme, 'dark');
  assert.equal(p.label.textContent, 'Light mode');
  assert.equal(p.button.attributes['aria-pressed'], 'true');
  assert.equal(p.colour.content, '#253750');
  p.handlers.click();
  assert.equal(p.storage.get('entomology-theme'), 'light');
  assert.equal(p.label.textContent, 'Dark mode');
  assert.equal(p.button.attributes['aria-pressed'], 'false');
  assert.equal(p.colour.content, '#eaf1fa');
});
