import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(new URL('../scripts/verify-release.mjs', import.meta.url));
const version = '2.3.4';
const successStatus = 0;
const failureStatus = 1;
let fixture = '';

const verify = (args = [version]) =>
	spawnSync(process.execPath, [verifier, ...args], {
		cwd: fixture,
		encoding: 'utf8',
	});

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), 'tavern-release-'));
	writeFileSync(join(fixture, 'package.json'), JSON.stringify({ version }));
	writeFileSync(
		join(fixture, 'manifest.json'),
		JSON.stringify({ version, minAppVersion: '1.8.7' }),
	);
	writeFileSync(join(fixture, 'versions.json'), JSON.stringify({ [version]: '1.8.7' }));
	writeFileSync(join(fixture, 'main.js'), 'module.exports = class Tavern {};\n');
	writeFileSync(join(fixture, 'styles.css'), '.tavern { display: flex; }\n');
});

afterEach(() => {
	rmSync(fixture, { recursive: true, force: true });
});

describe('release verification CLI', () => {
	it('accepts consistent release metadata and valid, nonempty assets', () => {
		const result = verify();
		expect(result.status).toBe(successStatus);
		expect(result.stderr).toBe('');
	});

	it('requires the expected release version', () => {
		const result = verify([]);
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain('Expected a release version argument.');
	});

	it.each([
		{ file: 'package.json', candidate: '2.3.3' },
		{ file: 'package.json', candidate: undefined },
		{ file: 'manifest.json', candidate: '2.3.3' },
		{ file: 'manifest.json', candidate: undefined },
	])('rejects $file version $candidate', ({ file, candidate }) => {
		const path = join(fixture, file);
		const metadata = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string | undefined>;
		metadata.version = candidate;
		writeFileSync(path, JSON.stringify(metadata));
		const result = verify();
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain(`${file} version must be ${version}.`);
	});

	it.each([{}, { [version]: '1.7.0' }])('rejects an incorrect compatibility map %j', (versions) => {
		writeFileSync(join(fixture, 'versions.json'), JSON.stringify(versions));
		const result = verify();
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain(
			`versions.json must map ${version} to manifest.json minAppVersion.`,
		);
	});

	it('rejects missing minimum application version metadata', () => {
		writeFileSync(join(fixture, 'manifest.json'), JSON.stringify({ version }));
		writeFileSync(join(fixture, 'versions.json'), '{}');
		const result = verify();
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain(
			`versions.json must map ${version} to manifest.json minAppVersion.`,
		);
	});

	it.each(['main.js', 'manifest.json', 'styles.css'])('rejects a missing asset %s', (asset) => {
		rmSync(join(fixture, asset));
		const result = verify();
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain(asset);
		expect(result.stderr).toContain('ENOENT');
	});

	it.each(['main.js', 'manifest.json', 'styles.css'])('rejects an empty asset %s', (asset) => {
		writeFileSync(join(fixture, asset), '');
		const result = verify();
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain(`Release asset ${asset} must be a nonempty file.`);
	});

	it('rejects a nonempty bundle with invalid JavaScript', () => {
		writeFileSync(join(fixture, 'main.js'), 'module.exports = {;\n');
		const result = verify();
		expect(result.status).toBe(failureStatus);
		expect(result.stderr).toContain('SyntaxError');
	});
});
