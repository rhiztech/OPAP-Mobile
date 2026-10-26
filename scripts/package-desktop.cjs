const packager = require('electron-packager');
const path = require('path');

async function build() {
  try {
    console.log('Starting electron-packager...');
    const appPaths = await packager({
      dir: '.',
      name: 'OPAP-Mobile',
      platform: 'win32',
      arch: 'x64',
      out: 'dist-installers',
      icon: 'installer-src/app-icon.ico',
      overwrite: true,
      asar: false,
      ignore: [
        /^\/android-project/,
        /^\/Figma/,
        /^\/\.figma/,
        /^\/dist-installers/,
        /^\/installer-src/,
        /^\/src/,
        /^\/\.git/,
        /^\/node_modules\/electron-packager/,
        /^\/node_modules\/electron($|\/)/
      ]
    });
    console.log('Packaging finished successfully! Paths:');
    console.log(appPaths);
  } catch (err) {
    console.error('Packaging failed with error:', err);
    process.exit(1);
  }
}

build();
