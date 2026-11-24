// The product page's sample call, read as a finished call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lineAt, mergeLines, statusLabel } from '../src/format.ts';
import { sampleStep, sampleToCall } from '../src/sample.ts';

const sample = JSON.parse(fs.readFileSync(new URL('../public/examples/northstar-billing.json', import.meta.url)));

test('the sample call shows as a finished call that reached its goal', () => {
  const call = sampleToCall(sample);
  assert.equal(call.finished, true);
  assert.equal(statusLabel(call).text, 'Done');
  assert.equal(call.talk_seconds, sample.duration_seconds);
  assert.equal(call.transcript.length, sample.lines.length);
});

test('sample lines keep their recording times, so a click jumps and the playing line is found', () => {
  const lines = mergeLines(sampleToCall(sample).transcript);
  assert.ok(lines.length < sample.lines.length); // close fragments of one speaker are one bubble
  assert.ok(lines.every((l) => l.who === 'event' || typeof l.at === 'number'));
  const first = lines.findIndex((l) => l.who !== 'event');
  assert.equal(lineAt(lines, lines[first].at), first);
  assert.equal(lineAt(lines, 0), -1); // before the first line
});

test('the call line follows the recording: dialing, menu, hold, person, ended', () => {
  const at = (t) => sampleStep(sample.lines, t, sample.duration_seconds);
  assert.deepEqual([0, 10, 30, 60, 72, 100, 129].map(at), [0, 1, 2, 2, 3, 3, 5]);
});

test('every example in the index has its two files', () => {
  const dir = new URL('../public/examples/', import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL('index.json', dir)));
  assert.ok(index.length >= 1);
  for (const e of index) {
    assert.ok(fs.existsSync(new URL(e.audio, dir)), e.audio);
    assert.equal(typeof JSON.parse(fs.readFileSync(new URL(e.transcript, dir))).lines.length, 'number');
  }
});
