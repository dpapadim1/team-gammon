import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = readFileSync(new URL('../.github/workflows/ios.yml', import.meta.url), 'utf8');

function runStep(t, name) {
  const block = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
  assert.ok(block, `workflow contains ${name}`);
  const script = block.split('        run: |\n')[1]
    .split('\n').map(line => line.slice(10)).join('\n')
    .replace('${{ github.run_number }}', '42');
  const directory = mkdtempSync(join(tmpdir(), 'ios-workflow-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = execFileSync('bash', ['-eu', '-c', `
    xcodebuild() { printf '%s\\n' "$@"; }
    ${script}
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RUNNER_TEMP: directory,
      TEAM_ID: 'test-team',
      ASC_KEY_PATH: join(directory, 'test-key.p8'),
      ASC_KEY_ID: 'test-key-id',
      ASC_ISSUER_ID: 'test-issuer',
    },
  });
  return { args: output.trim().split('\n'), directory };
}

test('TestFlight archive needs no development signing or provisioning', t => {
  const { args, directory } = runStep(t, 'Archive');
  assert.equal(args[0], 'archive');
  assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.ok(args.includes('DEVELOPMENT_TEAM=test-team'));
  assert.ok(args.includes('CURRENT_PROJECT_VERSION=42'));
  assert.equal(args[args.indexOf('-configuration') + 1], 'Release');
  assert.equal(args[args.indexOf('-destination') + 1], 'generic/platform=iOS');
  assert.equal(args[args.indexOf('-archivePath') + 1], join(directory, 'App.xcarchive'));
  assert.ok(!args.includes('-allowProvisioningUpdates'));
});

test('TestFlight export retains automatic App Store signing and API authentication', t => {
  const { args, directory } = runStep(t, 'Export and upload to App Store Connect');
  assert.equal(args[0], '-exportArchive');
  assert.ok(args.includes('-allowProvisioningUpdates'));
  assert.ok(!args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.equal(args[args.indexOf('-archivePath') + 1], join(directory, 'App.xcarchive'));
  assert.equal(args[args.indexOf('-authenticationKeyPath') + 1], join(directory, 'test-key.p8'));
  assert.equal(args[args.indexOf('-authenticationKeyID') + 1], 'test-key-id');
  assert.equal(args[args.indexOf('-authenticationKeyIssuerID') + 1], 'test-issuer');
  const plist = readFileSync(args[args.indexOf('-exportOptionsPlist') + 1], 'utf8');
  assert.match(plist, /<key>method<\/key><string>app-store-connect<\/string>/);
  assert.match(plist, /<key>destination<\/key><string>upload<\/string>/);
  assert.match(plist, /<key>signingStyle<\/key><string>automatic<\/string>/);
  assert.match(plist, /<key>teamID<\/key><string>test-team<\/string>/);
});
