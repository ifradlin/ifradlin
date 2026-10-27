// Run npm ci, then npm run generate beside the ifradlin.github.io checkout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createCanvas, GlobalFonts, loadImage} = require('@napi-rs/canvas');
const {svgPathProperties} = require('svg-path-properties');

const website = path.resolve(process.argv[2] || '../ifradlin.github.io');
const output = path.resolve(process.argv[3] || 'assets');
const source = fs.readFileSync(path.join(website, 'motion.js'), 'utf8');
const styles = fs.readFileSync(path.join(website, 'styles.css'), 'utf8');
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-motion-'));
const width = 1040, height = 200, fps = 30, overlap = 18;
GlobalFonts.registerFromPath('/System/Library/Fonts/SFNS.ttf', 'Profile Sans');
fs.mkdirSync(output, {recursive: true});

function color(name, theme) {
  return styles.match(new RegExp(`--${name}:light-dark\\((#[a-f0-9]+),(#[a-f0-9]+)\\)`))[theme === 'light' ? 1 : 2];
}

async function render(theme) {
  const folder = path.join(frames, theme);
  fs.mkdirSync(folder);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.clearRect = () => {
    context.save();
    context.globalAlpha = 1;
    context.fillStyle = theme === 'light' ? '#ffffff' : '#0d1117';
    context.fillRect(0, 0, width, height);
    context.restore();
  };
  const display = {
    dataset: {}, clientWidth: width, clientHeight: height,
    querySelector: () => canvas, addEventListener() {},
  };
  const elements = {
    '.motion-display': display,
    '.motion-playback': {addEventListener() {}},
    '.motion': {}, '.eyebrow': {color: color('muted', theme)},
    '.bio a': {color: color('accent', theme)},
  };
  const document = {
    hidden: false,
    documentElement: {classList: {contains: () => false}},
    querySelector: selector => elements[selector],
    createElement: () => createCanvas(300, 48),
    createElementNS: () => {
      let geometry;
      return {
        setAttribute: (_, d) => { geometry = new svgPathProperties(d); },
        getTotalLength: () => geometry.getTotalLength(),
        getPointAtLength: distance => geometry.getPointAtLength(distance),
      };
    },
    addEventListener() {},
  };
  const sandbox = vm.createContext({
    document,
    window: {matchMedia: () => ({matches: false, addEventListener() {}})},
    getComputedStyle: element => ({fontFamily: '"Profile Sans"', color: element.color}),
    requestAnimationFrame: () => 1, addEventListener() {}, devicePixelRatio: 1,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback(); }
    },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{isIntersecting: true}]); }
    },
    MutationObserver: class { observe() {} },
  });
  vm.runInContext(source, sandbox);
  const cycle = Math.round(vm.runInContext('(morphDuration + holdDuration) * shapes.length', sandbox) * fps);
  const firstFrames = [];
  for (let frame = 0; frame < cycle + overlap; frame++) {
    vm.runInContext(`tick(${1000 + frame * (1000 / fps + 0.001)})`, sandbox);
    if (frame < overlap) firstFrames.push(canvas.toBuffer('image/png'));
    // Blend the final ribbon into the opening frames to close the loop.
    if (frame >= cycle) {
      context.save();
      context.globalAlpha = (frame - cycle) / (overlap - 1);
      context.drawImage(await loadImage(firstFrames[frame - cycle]), 0, 0);
      context.restore();
    }
    if (frame === overlap) fs.writeFileSync(path.join(output, `geometry-${theme}.png`), canvas.toBuffer('image/png'));
    if (frame >= overlap) {
      fs.writeFileSync(path.join(folder, `${String(frame - overlap).padStart(4, '0')}.png`), canvas.toBuffer('image/png'));
    }
    if (frame % 120 === 0) console.log(`${theme}: frame ${frame}/${cycle + overlap}`);
  }
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps),
    '-i', path.join(folder, '%04d.png'), '-filter_complex',
    'fps=20,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', path.join(output, `geometry-${theme}.gif`),
  ]);
  console.log(`${theme}: GIF exported`);
}

(async () => {
  await render('light');
  await render('dark');
  fs.rmSync(frames, {recursive: true});
})();
