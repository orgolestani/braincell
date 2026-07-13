import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { cp, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'icons/braincells', // extension appended per-platform (.icns on mac)
    // The wired wrapper runs under the user's system `node` (not Electron),
    // so it and node-pty must live OUTSIDE the asar. extraResource flattens
    // basenames: Resources/wrapper/, Resources/node-pty/ — the wrapper's
    // require() falls back to ../node-pty accordingly.
    // node-pty ships from .staging (built in generateAssets below), NOT from
    // node_modules: the full module drags 63MB of win32 prebuilds/.pdbs into
    // a mac app. The staged copy is darwin-only (~1.3MB).
    extraResource: ['wrapper', '.staging/node-pty'],
  },
  rebuildConfig: {},
  hooks: {
    // Stage the darwin-only node-pty that extraResource ships.
    generateAssets: async () => {
      const src = 'node_modules/node-pty';
      const dst = '.staging/node-pty';
      await rm(dst, { recursive: true, force: true });
      const keep = [
        'package.json',
        'LICENSE',
        'lib', // runtime JS
        'build', // local darwin Release binary (tried before prebuilds)
        'prebuilds/darwin-arm64',
        'prebuilds/darwin-x64',
        'typings',
      ];
      for (const k of keep) {
        await cp(path.join(src, k), path.join(dst, k), { recursive: true });
      }
    },
    // Strip non-English Chromium locales (~49MB of .lproj), then restore the
    // ad-hoc signature — packager signs before this hook, and arm64 refuses
    // to launch a bundle whose seal no longer matches.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const out of outputPaths) {
        const apps = (await readdir(out)).filter((e) => e.endsWith('.app'));
        for (const app of apps) {
          const res = path.join(
            out,
            app,
            'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources',
          );
          for (const entry of await readdir(res)) {
            if (entry.endsWith('.lproj') && entry !== 'en.lproj') {
              await rm(path.join(res, entry), { recursive: true });
            }
          }
          execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(out, app)]);
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
