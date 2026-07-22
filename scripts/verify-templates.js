#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:4173';
let serverProcess;
let exitCode = 0;

function log(label, detail = '') {
  const pad = label.padEnd(14, ' ');
  console.log(`${pad} ${detail}`);
}

async function req(method, path, body) {
  const url = `${BASE}${path}`;
  const options = { method, headers: { 'content-type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`  FAIL: ${message}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    exitCode = 1;
    return false;
  }
  console.log(`  ok   ${message}`);
  return true;
}

function assertTrue(value, message) {
  if (!value) {
    console.error(`  FAIL: ${message}`);
    exitCode = 1;
    return false;
  }
  console.log(`  ok   ${message}`);
  return true;
}

async function startServer() {
  log('boot', 'starting server in mock mode...');
  serverProcess = spawn('node', ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GORO_GENERATE_MODE: 'mock', PORT: '4173' },
    stdio: 'pipe'
  });
  await setTimeout(800);
  // Health check
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${BASE}/api/tweet-lab/config`);
      if (res.ok) { log('boot', 'server ready'); return; }
    } catch {}
    await setTimeout(300);
  }
  throw new Error('Server did not start');
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await setTimeout(500);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
}

async function run() {
  await startServer();

  console.log('\n--- Template CRUD API ---');

  // 1. Create template with recipe fields
  const createRes = await req('POST', '/api/tweet-lab/store/templates', {
    name: 'Contrarian hook',
    body: 'Most people think X. The real leverage is Y.',
    tags: ['operator-loop', 'positioning'],
    formats: ['contrarian'],
    note: 'Use when the audience assumes the wrong bottleneck.',
    intent: 'Produce a contrarian angle that reframes the reader\'s assumption.',
    whenToUse: 'When the source tweet states a consensus belief that can be challenged.',
    constraints: 'Under 240 chars. No questions. No guru binaries.',
    exampleOutput: 'Everyone says you need more tools. The real bottleneck is deciding which loop to own.',
    sourceRequirements: 'A tweet expressing a common belief or consensus.',
    forbiddenPatterns: 'No "here\'s the thing", no "the real X is Y" closers.'
  });
  assertEqual(createRes.status, 201, 'create template returns 201');
  assertTrue(createRes.json?.id, 'create template returns id');
  const templateId = createRes.json.id;
  assertEqual(createRes.json.name, 'Contrarian hook', 'template name persisted');
  assertEqual(createRes.json.body, 'Most people think X. The real leverage is Y.', 'template body persisted');
  assertEqual(createRes.json.intent, 'Produce a contrarian angle that reframes the reader\'s assumption.', 'intent persisted');
  assertEqual(createRes.json.constraints, 'Under 240 chars. No questions. No guru binaries.', 'constraints persisted');
  assertEqual(createRes.json.exampleOutput, 'Everyone says you need more tools. The real bottleneck is deciding which loop to own.', 'exampleOutput persisted');

  // 2. List templates
  const listRes = await req('GET', '/api/tweet-lab/store/templates');
  assertEqual(listRes.status, 200, 'list templates returns 200');
  assertTrue(Array.isArray(listRes.json), 'list templates returns array');
  assertTrue(listRes.json.some(t => t.id === templateId), 'list includes created template');
  const listed = listRes.json.find(t => t.id === templateId);
  assertEqual(listed?.intent, 'Produce a contrarian angle that reframes the reader\'s assumption.', 'list includes intent');

  // 3. Get single template
  const getRes = await req('GET', `/api/tweet-lab/store/templates/${encodeURIComponent(templateId)}`);
  assertEqual(getRes.status, 200, 'get template returns 200');
  assertEqual(getRes.json.id, templateId, 'get template id matches');
  assertEqual(getRes.json.forbiddenPatterns, 'No "here\'s the thing", no "the real X is Y" closers.', 'forbiddenPatterns persisted');

  // 4. Update template
  const updateRes = await req('PATCH', `/api/tweet-lab/store/templates/${encodeURIComponent(templateId)}`, {
    name: 'Contrarian hook — updated',
    note: 'Updated note',
    sourceRequirements: 'Tweet with a claim that can be inverted.'
  });
  assertEqual(updateRes.status, 200, 'update template returns 200');
  assertEqual(updateRes.json.name, 'Contrarian hook — updated', 'update name applied');
  assertEqual(updateRes.json.note, 'Updated note', 'update note applied');
  assertEqual(updateRes.json.body, 'Most people think X. The real leverage is Y.', 'update preserves body');
  assertEqual(updateRes.json.sourceRequirements, 'Tweet with a claim that can be inverted.', 'update adds sourceRequirements');
  assertEqual(updateRes.json.constraints, 'Under 240 chars. No questions. No guru binaries.', 'update preserves constraints');

  // 5. Delete template
  const delRes = await req('DELETE', `/api/tweet-lab/store/templates/${encodeURIComponent(templateId)}`);
  assertEqual(delRes.status, 200, 'delete template returns 200');
  assertEqual(delRes.json.ok, true, 'delete template returns ok');

  // Recreate for generation tests
  const recreateRes = await req('POST', '/api/tweet-lab/store/templates', {
    name: 'Owned loop',
    body: 'One owned loop beats ten rented automations because {{reason}}.',
    tags: ['systems'],
    formats: ['framework'],
    intent: 'Reframe tooling debates around ownership vs rental.',
    constraints: 'No "that\'s the X; everything else is Y" closers.',
    forbiddenPatterns: 'No guru binaries. No "the real" constructions.'
  });
  const genTemplateId = recreateRes.json.id;

  console.log('\n--- Template in Generation Prompt ---');

  // 6. Generate with templateId
  const genRes = await req('POST', '/api/tweet-lab/generate', {
    context: 'Testing template wiring',
    tone: 'sharp',
    count: 1,
    templateId: genTemplateId
  });
  assertEqual(genRes.status, 200, 'generate with templateId returns 200');
  assertTrue(genRes.json?.sourcePacket?.templateId === genTemplateId, 'sourcePacket includes templateId');
  assertTrue(genRes.json?.sourcePacket?.template?.name === 'Owned loop', 'sourcePacket includes resolved template name');
  assertTrue(genRes.json?.promptPreview?.includes('Template: Owned loop'), 'prompt preview includes template block');
  assertTrue(genRes.json?.promptPreview?.includes('Intent:'), 'prompt preview includes intent');
  assertTrue(genRes.json?.promptPreview?.includes('Constraints:'), 'prompt preview includes constraints');
  assertTrue(genRes.json?.promptPreview?.includes('Forbidden patterns:'), 'prompt preview includes forbiddenPatterns');

  // 7. Draft receipt shows template
  assertTrue(Array.isArray(genRes.json?.drafts), 'generate returns drafts array');
  const draft = genRes.json.drafts[0];
  assertTrue(draft?.templateId === genTemplateId, 'draft receipt includes templateId');
  assertTrue(draft?.templateName === 'Owned loop', 'draft receipt includes templateName');

  // 8. Generate without templateId still works
  const genNoTemplate = await req('POST', '/api/tweet-lab/generate', {
    context: 'No template test',
    tone: 'sharp',
    count: 1
  });
  assertEqual(genNoTemplate.status, 200, 'generate without templateId returns 200');
  const noTemplateId = genNoTemplate.json?.sourcePacket?.templateId;
  assertTrue(noTemplateId === undefined || noTemplateId === null || noTemplateId === '', 'sourcePacket has no templateId when none selected');

  // 9. Import/export preserves recipe fields
  const exportRes = await req('GET', '/api/tweet-lab/store/templates?export=1');
  assertEqual(exportRes.status, 200, 'export returns 200');
  assertTrue(exportRes.json?.templates?.some(t => t.id === genTemplateId), 'export includes template');
  const exportedTemplate = exportRes.json.templates.find(t => t.id === genTemplateId);
  assertEqual(exportedTemplate?.intent, 'Reframe tooling debates around ownership vs rental.', 'export preserves intent');
  assertEqual(exportedTemplate?.constraints, 'No "that\'s the X; everything else is Y" closers.', 'export preserves constraints');

  console.log('\n--- Cleanup ---');
  await req('DELETE', `/api/tweet-lab/store/templates/${encodeURIComponent(genTemplateId)}`);
  log('cleanup', 'removed test template');

  await stopServer();
  console.log('\n' + (exitCode === 0 ? 'All checks passed.' : 'Some checks failed.'));
  // Force exit even if promises are dangling
  const { setTimeout } = await import('node:timers/promises');
  await setTimeout(100);
  process.exit(exitCode);
}

run().catch(async err => {
  console.error(err);
  await stopServer();
  process.exit(1);
});
