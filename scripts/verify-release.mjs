import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const [, , expectedVersion] = process.argv;
const emptySize = 0;

if (!expectedVersion) {
	throw new Error('Expected a release version argument.');
}

for (const asset of ['main.js', 'manifest.json', 'styles.css']) {
	const file = statSync(asset);
	if (!file.isFile() || file.size === emptySize) {
		throw new Error(`Release asset ${asset} must be a nonempty file.`);
	}
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

if (packageJson.version !== expectedVersion) {
	throw new Error(`package.json version must be ${expectedVersion}.`);
}

if (manifest.version !== expectedVersion) {
	throw new Error(`manifest.json version must be ${expectedVersion}.`);
}

if (
	typeof manifest.minAppVersion !== 'string' ||
	!manifest.minAppVersion ||
	versions[expectedVersion] !== manifest.minAppVersion
) {
	throw new Error(`versions.json must map ${expectedVersion} to manifest.json minAppVersion.`);
}

execFileSync(process.execPath, ['--check', 'main.js'], { stdio: 'inherit' });
