import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('..', import.meta.url));

// Exercise the real dev task graph with clean shared-package outputs. Application
// processes just import the runtime dependency, so this gate needs no services.
for (const [name, args, applications] of [
  ['root dev', ['dev'], ['backend', 'frontend']],
  [
    'filtered backend dev',
    ['exec', 'turbo', 'run', 'dev', '--filter=@paper-app/backend'],
    ['backend']
  ]
]) {
  test(`${name} builds the shared runtime before starting consumers`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-dev-startup-'));
    try {
      for (const file of [
        'package.json',
        'pnpm-workspace.yaml',
        'pnpm-lock.yaml',
        'turbo.json'
      ]) {
        await cp(join(repository, file), join(directory, file));
      }
      // Dependencies below are deliberately supplied by the test fixture.
      await appendFile(
        join(directory, 'pnpm-workspace.yaml'),
        '\nverifyDepsBeforeRun: false\n'
      );
      // Never link the entire node_modules directory: package managers may
      // relink it when they detect that a fixture's workspace state changed.
      await mkdir(join(directory, 'node_modules'), { recursive: true });
      const types = join(directory, 'packages/types');
      await mkdir(types, { recursive: true });
      for (const file of ['package.json', 'tsconfig.json', 'src']) {
        await cp(join(repository, 'packages/types', file), join(types, file), {
          recursive: true
        });
      }
      for (const application of ['backend', 'frontend']) {
        const app = join(directory, 'apps', application);
        await mkdir(join(app, 'node_modules/@paper-app'), { recursive: true });
        const manifest = JSON.parse(
          await readFile(
            join(repository, 'apps', application, 'package.json'),
            'utf8'
          )
        );
        manifest.scripts = { dev: 'node dev.mjs' };
        await writeFile(join(app, 'package.json'), JSON.stringify(manifest));
        await symlink(types, join(app, 'node_modules/@paper-app/types'), 'dir');
        await writeFile(
          join(app, 'dev.mjs'),
          `import { ARTICLE_TITLE_MAX_LENGTH } from '@paper-app/types';
if (ARTICLE_TITLE_MAX_LENGTH !== 200) throw new Error('Shared runtime unavailable');
console.log('${application} runtime ready');
`
        );
      }
      const result = spawnSync('pnpm', args, {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${join(repository, 'node_modules/.bin')}:${process.env.PATH}`,
          npm_config_offline: 'true',
          TURBO_FORCE: 'true',
          TURBO_TELEMETRY_DISABLED: '1'
        },
        encoding: 'utf8',
        timeout: 30_000
      });
      assert.equal(
        result.status,
        0,
        `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`
      );
      for (const application of applications) {
        assert.match(result.stdout, new RegExp(`${application} runtime ready`));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
