import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const passed = readFileSync(new URL('./fixtures/classification-junit/postgres-passed.xml', import.meta.url), 'utf8');
const browserPassed = readFileSync(new URL('./fixtures/classification-junit/browser-passed.xml', import.meta.url), 'utf8');
const skipped = readFileSync(new URL('./fixtures/classification-junit/browser-skipped.xml', import.meta.url), 'utf8');
const checker = new URL('../scripts/check-classification-junit.py', import.meta.url).pathname;
function check(xml: string | Buffer, profile = 'postgres') {
 const directory = mkdtempSync(join(tmpdir(), 'lifeos-junit-gate-'));
 try {
  const report = join(directory, 'result.xml'); writeFileSync(report, xml);
  return spawnSync('python3', [checker, profile, report], {encoding: 'utf8'});
 } finally { rmSync(directory, {recursive: true, force: true}); }
}
test('actual native PG JUnit requires both enabled suites and all 64 leaf cases', () => {
 const result = check(passed);
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, /64 leaf cases/);
});
test('actual enabled Chrome JUnit requires all six enabled direct browser cases', () => {
 const result = check(browserPassed, 'browser');
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, /0 suites, 6 leaf cases/);
});
const entityReport = browserPassed.replace('encoding="utf-8"', 'encoding="utf-16"')
 .replace('<testsuites>', '<!DOCTYPE testsuites [<!ENTITY prefix "classification">]><testsuites>')
 .replaceAll('name="classification ', 'name="&prefix; ');
const utf16leEntity = Buffer.from(entityReport, 'utf16le');
const utf16beEntity = Buffer.from(utf16leEntity).swap16();
const byteReports: [string, Buffer][] = [
 ['UTF-16LE entity report with BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), utf16leEntity])],
 ['UTF-16LE entity report without BOM', utf16leEntity],
 ['UTF-16BE entity report with BOM', Buffer.concat([Buffer.from([0xfe, 0xff]), utf16beEntity])],
 ['UTF-16BE entity report without BOM', utf16beEntity],
 ['non-UTF-8 encoding declaration over UTF-8 bytes', Buffer.from(browserPassed.replace('encoding="utf-8"', 'encoding="iso-8859-1"'), 'utf8')],
 ['single-quoted non-UTF-8 encoding declaration', Buffer.from(browserPassed.replace('encoding="utf-8"', "encoding = 'ISO-8859-1'"), 'utf8')],
 ['NUL in UTF-8 report', Buffer.from(browserPassed + '\0', 'utf8')],
 ['invalid UTF-8 byte', Buffer.concat([Buffer.from(browserPassed, 'utf8'), Buffer.from([0xff])])],
];
for (const [name, bytes] of byteReports) test(`classification JUnit gate rejects raw ${name}`, () => {
 const result = check(bytes, 'browser');
 assert.notEqual(result.status, 0, result.stdout);
 assert.match(result.stderr, /CLASSIFICATION_JUNIT_DENIED/);
});
const browserLeaves = browserPassed.match(/<testcase[^>]+\/>/g)!;
const browserMutations: [string, (xml: string) => string][] = [
 ['missing second case', xml => xml.replace(browserLeaves[1], '')],
 ['missing new read-serialization case', xml => xml.replace(browserLeaves[2], '')],
 ['missing new reference-version case', xml => xml.replace(browserLeaves[3], '')],
 ['missing no-op readback case', xml => xml.replace(browserLeaves[4], '')],
 ['missing item authentication case', xml => xml.replace(browserLeaves[5], '')],
 ['missing both new cases', xml => xml.replace(browserLeaves[2], '').replace(browserLeaves[3], '')],
 ['duplicate case with unchanged total', xml => xml.replace(browserLeaves[1], browserLeaves[0])],
 ['substituted case with unchanged total', xml => xml.replace('classification guards and readback preserve the workspace under uncertain outcomes', 'unqualified replacement')],
 ['skipped direct case', xml => xml.replace(browserLeaves[1], browserLeaves[1].replace('/>', '><skipped/></testcase>'))],
 ['failed direct case', xml => xml.replace(browserLeaves[1], browserLeaves[1].replace('/>', '><failure/></testcase>'))],
 ['errored direct case', xml => xml.replace(browserLeaves[1], browserLeaves[1].replace('/>', '><error/></testcase>'))],
 ['wrong direct source', xml => xml.replaceAll('test/classification-review-browser.integration.test.ts', 'test/unqualified.integration.test.ts')],
];
for (const [name, mutate] of browserMutations) test(`classification browser JUnit gate rejects ${name}`, () => {
 const result = check(mutate(browserPassed), 'browser');
 assert.notEqual(result.status, 0, result.stdout);
 assert.match(result.stderr, /CLASSIFICATION_JUNIT_DENIED/);
});
test('default-closed browser testcase is rejected despite its successful Node process', () => {
 const result = check(skipped, 'browser');
 assert.notEqual(result.status, 0);
 assert.match(result.stderr, /skipped/);
});
const leaf = passed.match(/<testcase[^>]+\/>/)![0];
const mutations: [string, (xml: string) => string][] = [
 ['missing suite', xml => xml.replace(/  <testsuite[^>]*>[\s\S]*?<\/testsuite>\n/, '')],
 ['missing leaf', xml => xml.replace(leaf, '')],
 ['duplicate suite', xml => xml.replace('</testsuites>', xml.match(/  <testsuite[^>]*>[\s\S]*?<\/testsuite>/)![0] + '</testsuites>')],
 ['duplicate leaf', xml => xml.replace(leaf, leaf + leaf)],
 ['substituted leaf with unchanged total', xml => xml.replace('three separate forced-RLS tables qualify without changing schema2 and original four-table gate', 'unqualified replacement')],
 ['skipped leaf', xml => xml.replace(leaf, leaf.replace('/>', '><skipped/></testcase>'))],
 ['failed leaf', xml => xml.replace(leaf, leaf.replace('/>', '><failure/></testcase>'))],
 ['errored leaf', xml => xml.replace(leaf, leaf.replace('/>', '><error/></testcase>'))],
 ['failed parent', xml => xml.replace('</testsuite>', '<failure/></testsuite>')],
 ['incorrect summary', xml => xml.replace('tests="31"', 'tests="30"')],
 ['disabled summary', xml => xml.replace('disabled="0"', 'disabled="1"')],
 ['skipped summary', xml => xml.replace('skipped="0"', 'skipped="1"')],
 ['failed summary', xml => xml.replace('failures="0"', 'failures="1"')],
 ['error summary', xml => xml.replace('errors="0"', 'errors="1"')],
 ['missing summary', xml => xml.replace(' failures="0"', '')],
 ['malformed summary', xml => xml.replace('tests="31"', 'tests="NaN"')],
 ['wrong source', xml => xml.replaceAll('test/classification-postgres.integration.test.ts', 'test/unqualified.integration.test.ts')],
 ['unexpected root leaf', xml => xml.replace('</testsuites>', leaf + '</testsuites>')],
 ['malformed XML', xml => xml.slice(0, -20)],
 ['wrong root', () => '<testsuite/>'],
 ['empty report', () => ''],
 ['XML entity declaration', xml => xml.replace('<testsuites>', '<!DOCTYPE testsuites [<!ENTITY fixture "unqualified">]><testsuites>')],
 ['oversized report', xml => xml + ' '.repeat(2_000_000)],
];
for (const [name, mutate] of mutations) test(`classification JUnit gate rejects ${name}`, () => {
 const result = check(mutate(passed));
 assert.notEqual(result.status, 0, result.stdout);
 assert.match(result.stderr, /CLASSIFICATION_JUNIT_DENIED/);
});
test('classification JUnit gate rejects missing report and unknown profile', () => {
 for (const args of [['postgres', '/missing/lifeos-junit.xml'], ['unqualified', '/missing/lifeos-junit.xml']]) {
  const result = spawnSync('python3', [checker, ...args], {encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /CLASSIFICATION_JUNIT_DENIED/);
 }
});
