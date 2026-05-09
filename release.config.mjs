/* oxlint-disable eslint/no-template-curly-in-string */
const releaseConfig = {
	branches: ['main'],
	tagFormat: '${version}',
	plugins: [
		'@semantic-release/commit-analyzer',
		'@semantic-release/release-notes-generator',
		[
			'@semantic-release/changelog',
			{
				changelogFile: 'CHANGELOG.md',
			},
		],
		[
			'@semantic-release/exec',
			{
				prepareCmd: 'pnpm run release:version ${nextRelease.version} && pnpm run build',
			},
		],
		[
			'@semantic-release/github',
			{
				successComment: false,
				failComment: false,
				assets: [
					{
						path: 'manifest.json',
						label: 'manifest.json',
					},
					{
						path: 'main.js',
						label: 'main.js',
					},
					{
						path: 'styles.css',
						label: 'styles.css',
					},
				],
			},
		],
		[
			'@semantic-release/git',
			{
				assets: ['CHANGELOG.md', 'package.json', 'manifest.json', 'versions.json'],
				message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
			},
		],
	],
};

export default releaseConfig;
