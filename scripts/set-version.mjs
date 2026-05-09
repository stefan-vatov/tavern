/* oxlint-disable import/no-nodejs-modules */
import { readFileSync, writeFileSync } from 'node:fs';

const versionArgumentIndex = 2;
const emptyLength = 0;

const targetVersion = process.argv[versionArgumentIndex] ?? process.env.npm_package_version;

if (typeof targetVersion !== 'string' || targetVersion.length === emptyLength) {
	throw new Error('Expected a semantic version argument.');
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
	throw new Error(`Expected a semantic version, received "${targetVersion}".`);
}

const writeJson = (path, value) => {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
};

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
packageJson.version = targetVersion;
writeJson('package.json', packageJson);

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeJson('manifest.json', manifest);

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeJson('versions.json', versions);
